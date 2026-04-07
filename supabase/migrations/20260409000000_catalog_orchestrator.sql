-- Orchestrateur : confiance marché, compteur de recherches, RPC d’incrément

ALTER TABLE public.catalog_prices
  ADD COLUMN IF NOT EXISTS confidence_score smallint
    CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)),
  ADD COLUMN IF NOT EXISTS search_count integer NOT NULL DEFAULT 0
    CHECK (search_count >= 0);

COMMENT ON COLUMN public.catalog_prices.confidence_score IS
  '0–100 : qualité dernière estimation live (Apify) ; NULL si catalogue seul / manuel.';
COMMENT ON COLUMN public.catalog_prices.search_count IS
  'Nombre de recherches utilisateur sur cette fiche (best-sellers).';

CREATE OR REPLACE FUNCTION public.increment_catalog_search_count(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.catalog_prices
  SET search_count = search_count + 1
  WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION public.increment_catalog_search_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_catalog_search_count(uuid) TO service_role;

ALTER TABLE public.shopping_median_cache
  ADD COLUMN IF NOT EXISTS confidence_score smallint
    CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)),
  ADD COLUMN IF NOT EXISTS needs_review boolean;
