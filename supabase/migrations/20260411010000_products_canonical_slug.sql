-- Canonical matching: slug principal de reconciliation.

ALTER TABLE public.products
  ALTER COLUMN ean_code DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS canonical_slug text;

CREATE INDEX IF NOT EXISTS idx_products_canonical_slug
  ON public.products (canonical_slug);

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_canonical_slug_category
  ON public.products (canonical_slug, category)
  WHERE canonical_slug IS NOT NULL;
