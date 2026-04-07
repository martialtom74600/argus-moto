-- Répare les refus d'insert (check constraint) quand la base n'a pas encore
-- 'pantalon' ou quand le nom de contrainte diffère de products_category_check.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname::text AS cname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'products'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%category%'
      AND pg_get_constraintdef(c.oid) ILIKE '%casque%'
  LOOP
    EXECUTE format('ALTER TABLE public.products DROP CONSTRAINT IF EXISTS %I', r.cname);
  END LOOP;
END $$;

ALTER TABLE public.products
  ADD CONSTRAINT products_category_check CHECK (
    category = ANY (
      ARRAY['casque', 'blouson', 'gants', 'bottes', 'pantalon']::text[]
    )
  );
