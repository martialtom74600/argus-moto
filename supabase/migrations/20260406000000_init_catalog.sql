-- Référentiel prix neuf + matching pg_trgm (Supabase / PostgreSQL)

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE TABLE public.catalog_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL,
  model text NOT NULL,
  category text NOT NULL,
  retail_price numeric(10, 2) NOT NULL CHECK (retail_price > 0),
  image_url text,
  source text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_prices_category_check CHECK (
    category = ANY (ARRAY['casque', 'blouson', 'gants', 'bottes']::text[])
  ),
  CONSTRAINT catalog_prices_brand_model_category_unique UNIQUE (brand, model, category)
);

CREATE INDEX idx_catalog_brand_model_trgm ON public.catalog_prices
USING gin ((lower(brand || ' ' || model)) gin_trgm_ops);

CREATE INDEX idx_catalog_prices_category ON public.catalog_prices (category)
WHERE is_active = true;

COMMENT ON TABLE public.catalog_prices IS 'Prix public conseillé (neuf) pour le moteur de rachat';

-- Meilleur match par similarité trigram (0 = rien en commun, 1 = identique après normalisation interne)
CREATE OR REPLACE FUNCTION public.match_catalog_item(search_query text, item_category text)
RETURNS TABLE (
  id uuid,
  brand text,
  model text,
  category text,
  retail_price numeric,
  image_url text,
  similarity_score real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.brand,
    c.model,
    c.category,
    c.retail_price,
    c.image_url,
    similarity(
      lower(trim(both FROM c.brand || ' ' || c.model)),
      lower(trim(both FROM search_query))
    )::real AS similarity_score
  FROM public.catalog_prices AS c
  WHERE c.is_active = true
    AND c.category = lower(trim(both FROM item_category))
  ORDER BY similarity_score DESC NULLS LAST
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.match_catalog_item(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.match_catalog_item(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_catalog_item(text, text) TO service_role;

-- Données de test (4 références)
INSERT INTO public.catalog_prices (brand, model, category, retail_price, source) VALUES
  ('Shark', 'D-Skwal 3', 'casque', 200.00, 'migration_seed'),
  ('Scorpion', 'Exo-R1 Air', 'casque', 330.00, 'migration_seed'),
  ('Alpinestars', 'T-GP Plus R v4', 'blouson', 260.00, 'migration_seed'),
  ('Furygan', 'Apalaches', 'blouson', 230.00, 'migration_seed');

ALTER TABLE public.catalog_prices ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE public.catalog_prices TO anon;
GRANT SELECT ON TABLE public.catalog_prices TO authenticated;

-- Lecture publique du catalogue actif (utile pour futurs usages client)
CREATE POLICY "catalog_prices_select_active"
  ON public.catalog_prices
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- Le service_role contourne RLS pour upserts / admin
