-- Expose updated_at + colonne similarity (impossible de « REPLACE » si le RETURNS TABLE change : DROP puis CREATE).

DROP FUNCTION IF EXISTS public.match_catalog_item(text, text);

CREATE FUNCTION public.match_catalog_item(search_query text, item_category text)
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
      c.id,
      c.brand,
      c.model,
      c.category,
      c.retail_price,
      c.image_url,
      similarity(
        lower(trim(both FROM c.brand || ' ' || c.model)),
        lower(trim(both FROM search_query))
      )::real AS similarity,
      c.updated_at
    FROM public.catalog_prices AS c
    WHERE c.is_active = true
      AND c.category = lower(trim(both FROM item_category))
  ) AS ranked
  ORDER BY ranked.similarity DESC NULLS LAST
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.match_catalog_item(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.match_catalog_item(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_catalog_item(text, text) TO service_role;
