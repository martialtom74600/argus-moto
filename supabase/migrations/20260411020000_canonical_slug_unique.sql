-- Canonical slug devient clé de réconciliation principale.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS canonical_slug text;

DROP INDEX IF EXISTS public.uq_products_canonical_slug_category;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_canonical_slug
  ON public.products (canonical_slug)
  WHERE canonical_slug IS NOT NULL;
