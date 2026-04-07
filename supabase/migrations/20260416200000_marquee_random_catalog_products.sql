-- Vitre home : échantillon aléatoire du catalogue (table public.products — équivalent applicatif « catalog_products »).
CREATE OR REPLACE FUNCTION public.random_catalog_products_for_marquee(p_limit integer DEFAULT 20)
RETURNS TABLE (
  id uuid,
  brand text,
  model text,
  image_url text,
  retail_basis_eur numeric
)
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.brand,
    p.model,
    p.image_url,
    p.aggregated_retail_eur AS retail_basis_eur
  FROM public.products AS p
  WHERE p.image_url IS NOT NULL
    AND length(btrim(p.image_url)) > 0
    AND p.aggregated_retail_eur IS NOT NULL
    AND p.aggregated_retail_eur > 0
  ORDER BY random()
  LIMIT COALESCE(NULLIF(p_limit, 0), 20);
$$;

REVOKE ALL ON FUNCTION public.random_catalog_products_for_marquee(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.random_catalog_products_for_marquee(integer) TO service_role;
