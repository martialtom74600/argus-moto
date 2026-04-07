-- Catégorie distincte pour les pantalons (textile / cuir moto).

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_category_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_category_check CHECK (
    category = ANY (
      ARRAY['casque', 'blouson', 'gants', 'bottes', 'pantalon']::text[]
    )
  );
