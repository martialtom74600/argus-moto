-- Pivot "souveraineté data" : catalog_prices devient la source de vérité.

ALTER TABLE public.catalog_prices
  ADD COLUMN IF NOT EXISTS ean_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS retailer_source text,
  ADD COLUMN IF NOT EXISTS is_official_feed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.catalog_prices.ean_code IS
  'EAN/GTIN unique pour réconciliation exacte du produit.';
COMMENT ON COLUMN public.catalog_prices.retailer_source IS
  'Origine distributeur la plus récente (Motoblouz, Dafy, FC-Moto, ...).';
COMMENT ON COLUMN public.catalog_prices.is_official_feed IS
  'TRUE si la donnée provient de notre feed/crawler propriétaire validé.';

CREATE TABLE IF NOT EXISTS public.price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id uuid NOT NULL REFERENCES public.catalog_prices(id) ON DELETE CASCADE,
  price numeric(10, 2) NOT NULL CHECK (price > 0),
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_history_catalog_observed
  ON public.price_history (catalog_id, observed_at DESC);

ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE public.price_history TO anon;
GRANT SELECT ON TABLE public.price_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.price_history TO service_role;

CREATE POLICY "price_history_select_all"
  ON public.price_history
  FOR SELECT
  TO anon, authenticated
  USING (true);
