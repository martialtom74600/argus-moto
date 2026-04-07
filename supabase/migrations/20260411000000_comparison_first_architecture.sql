-- Architecture "Comparaison-First"

CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ean_code text UNIQUE NOT NULL,
  brand text NOT NULL,
  model text NOT NULL,
  category text NOT NULL,
  image_url text,
  is_accessory boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_category_check CHECK (
    category = ANY (ARRAY['casque', 'blouson', 'gants', 'bottes']::text[])
  )
);

CREATE TABLE IF NOT EXISTS public.retailer_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  retailer_name text NOT NULL,
  price numeric(10, 2) NOT NULL CHECK (price > 0),
  availability text,
  url text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_retailer_prices_product_retailer_url
  ON public.retailer_prices (product_id, retailer_name, url);

CREATE INDEX IF NOT EXISTS idx_retailer_prices_product_observed
  ON public.retailer_prices (product_id, observed_at DESC);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retailer_prices ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE public.products TO anon, authenticated;
GRANT SELECT ON TABLE public.retailer_prices TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.products TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.retailer_prices TO service_role;

CREATE POLICY "products_select"
  ON public.products
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "retailer_prices_select"
  ON public.retailer_prices
  FOR SELECT
  TO anon, authenticated
  USING (true);
