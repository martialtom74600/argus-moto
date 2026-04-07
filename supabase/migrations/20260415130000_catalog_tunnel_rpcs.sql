-- RPC tunnel estimation : marques / modèles par catégorie + match direct par slug.

CREATE OR REPLACE FUNCTION public.get_distinct_brands(category_name text)
RETURNS TABLE (brand text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT p.brand
  FROM public.products AS p
  WHERE p.is_accessory = false
    AND p.category = lower(trim(both FROM category_name))
  ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.get_models_by_brand(brand_name text, category_name text)
RETURNS TABLE (
  id uuid,
  model text,
  canonical_slug text,
  image_url text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.model,
    p.canonical_slug,
    p.image_url
  FROM public.products AS p
  WHERE p.is_accessory = false
    AND p.category = lower(trim(both FROM category_name))
    AND lower(trim(both FROM p.brand)) = lower(trim(both FROM brand_name))
  ORDER BY p.model;
$$;

CREATE OR REPLACE FUNCTION public.match_product_by_slug(p_slug text, item_category text)
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
    1::real AS similarity,
    p.updated_at
  FROM public.products AS p
  LEFT JOIN LATERAL (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY rp.price) AS med
    FROM public.retailer_prices AS rp
    WHERE rp.product_id = p.id
  ) AS agg ON true
  WHERE p.is_accessory = false
    AND p.category = lower(trim(both FROM item_category))
    AND lower(trim(both FROM p.canonical_slug)) = lower(trim(both FROM p_slug))
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_distinct_brands(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_distinct_brands(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_distinct_brands(text) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_models_by_brand(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_models_by_brand(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_models_by_brand(text, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.match_product_by_slug(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.match_product_by_slug(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_product_by_slug(text, text) TO service_role;
