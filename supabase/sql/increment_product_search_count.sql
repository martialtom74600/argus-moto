-- Voir aussi : supabase/migrations/20260412000000_unified_products_model.sql

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
