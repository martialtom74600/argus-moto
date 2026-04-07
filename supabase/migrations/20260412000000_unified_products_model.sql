-- Modèle unique : plus de catalog_prices / price_history en doublon.
-- Source de vérité : products + retailer_prices ; historique agrégé : product_price_history.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS aggregated_retail_eur numeric(10, 2)
    CHECK (aggregated_retail_eur IS NULL OR aggregated_retail_eur > 0),
  ADD COLUMN IF NOT EXISTS confidence_score smallint
    CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)),
  ADD COLUMN IF NOT EXISTS search_count integer NOT NULL DEFAULT 0
    CHECK (search_count >= 0),
  ADD COLUMN IF NOT EXISTS last_retailer_source text,
  ADD COLUMN IF NOT EXISTS last_official_feed boolean;

COMMENT ON COLUMN public.products.aggregated_retail_eur IS
  'Dernier prix neuf / médiane marché retenue pour l’offre (hors lignes marchands).';
COMMENT ON COLUMN public.products.search_count IS
  'Nombre de recherches utilisateur ayant matché cette fiche.';

CREATE TABLE IF NOT EXISTS public.product_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  price numeric(10, 2) NOT NULL CHECK (price > 0),
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_price_history_product_observed
  ON public.product_price_history (product_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_products_brand_model_trgm
  ON public.products
  USING gin ((lower(brand || ' ' || model)) gin_trgm_ops);

ALTER TABLE public.product_price_history ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE public.product_price_history TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.product_price_history TO service_role;

CREATE POLICY "product_price_history_select_all"
  ON public.product_price_history
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Migrer l’ancien catalogue (slug dédié pour éviter les collisions avec l’ingestion).
INSERT INTO public.products (
  ean_code,
  brand,
  model,
  category,
  image_url,
  is_accessory,
  canonical_slug,
  aggregated_retail_eur,
  confidence_score,
  search_count,
  updated_at,
  last_retailer_source,
  last_official_feed
)
SELECT
  c.ean_code,
  c.brand,
  c.model,
  c.category,
  c.image_url,
  COALESCE(c.is_accessory, false),
  'migrated-' || c.id::text,
  c.retail_price,
  c.confidence_score,
  COALESCE(c.search_count, 0),
  c.updated_at,
  c.retailer_source,
  c.is_official_feed
FROM public.catalog_prices c
WHERE c.is_active = true
  AND NOT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.canonical_slug = 'migrated-' || c.id::text
  )
  AND (
    c.ean_code IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.products p2 WHERE p2.ean_code = c.ean_code)
  );

INSERT INTO public.product_price_history (product_id, price, observed_at)
SELECT p.id, ph.price, ph.observed_at
FROM public.price_history ph
JOIN public.catalog_prices c ON c.id = ph.catalog_id
JOIN public.products p ON p.canonical_slug = 'migrated-' || c.id::text;

DROP FUNCTION IF EXISTS public.match_catalog_item(text, text);

CREATE FUNCTION public.match_product_item(search_query text, item_category text)
RETURNS TABLE (
  id uuid,
  brand text,
  model text,
  category text,
  retail_price numeric,
  image_url text,
  similarity real,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM (
    SELECT
      p.id,
      p.brand,
      p.model,
      p.category,
      COALESCE(
        p.aggregated_retail_eur,
        agg.med::numeric
      ) AS retail_price,
      p.image_url,
      similarity(
        lower(trim(both FROM p.brand || ' ' || p.model)),
        lower(trim(both FROM search_query))
      )::real AS similarity,
      p.updated_at
    FROM public.products AS p
    LEFT JOIN LATERAL (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY rp.price) AS med
      FROM public.retailer_prices AS rp
      WHERE rp.product_id = p.id
    ) AS agg ON true
    WHERE p.is_accessory = false
      AND p.category = lower(trim(both FROM item_category))
  ) AS ranked
  ORDER BY ranked.similarity DESC NULLS LAST
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.match_product_item(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.match_product_item(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_product_item(text, text) TO service_role;

DROP FUNCTION IF EXISTS public.increment_catalog_search_count(uuid);

CREATE OR REPLACE FUNCTION public.increment_product_search_count(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.products
  SET search_count = search_count + 1
  WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION public.increment_product_search_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_product_search_count(uuid) TO service_role;

DROP TABLE IF EXISTS public.price_history;
DROP TABLE IF EXISTS public.catalog_prices;
