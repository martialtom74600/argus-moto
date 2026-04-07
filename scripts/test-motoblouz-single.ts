import { createClient } from "@supabase/supabase-js";
import {
  extractMotoblouzFromUrl,
  upsertMotoblouzProduct,
} from "../lib/ingestion/motoblouz-simple";

const TEST_URL =
  "https://www.motoblouz.com/vente-casque-integral-shark-skwal-i3-mayfer-ecran-iridium-rose-334130.html";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Variable manquante: ${name}`);
  return v;
}

async function main(): Promise<void> {
  const extracted = await extractMotoblouzFromUrl(TEST_URL);
  if (!extracted) {
    console.error("Échec: extraction JSON-LD (Product / BreadcrumbList).");
    process.exit(1);
  }

  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY")
  );

  await upsertMotoblouzProduct(supabase, extracted, TEST_URL);

  console.log(
    `SUCCÈS : Produit ${extracted.brand} ${extracted.name} enregistré en catégorie ${extracted.category} avec le prix ${extracted.price}€`
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
