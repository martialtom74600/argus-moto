-- Patch : RPC increment_catalog_search_count manquante en prod
-- (ré-applicable sans risque : IF NOT EXISTS + CREATE OR REPLACE)

ALTER TABLE public.catalog_prices
  ADD COLUMN IF NOT EXISTS confidence_score smallint
    CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)),
  ADD COLUMN IF NOT EXISTS search_count integer NOT NULL DEFAULT 0
    CHECK (search_count >= 0);

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
