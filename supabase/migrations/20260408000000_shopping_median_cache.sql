-- Cache des médianes Google Shopping (réduit les coûts Apify pour les mêmes recherches)

CREATE TABLE public.shopping_median_cache (
  query_key text PRIMARY KEY,
  median_eur numeric(10, 2) NOT NULL CHECK (median_eur > 0),
  sample_count int NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_shopping_median_cache_fetched_at
  ON public.shopping_median_cache (fetched_at DESC);

COMMENT ON TABLE public.shopping_median_cache IS
  'Médiane prix neuf (Google Shopping via Apify) par empreinte produit ; TTL côté app.';
