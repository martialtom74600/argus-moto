import { createClient } from "@supabase/supabase-js";
import { crawlProductUrl } from "../lib/pricing/internal-crawler";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import stringSimilarity from "string-similarity";
import { generateCanonicalSlug } from "../lib/pricing/matcher";
import { discoverMotoblouzProductUrls } from "../lib/ingestion/motoblouz-master";

const PILOT_SIZE = 50;
const DEFAULT_CONCURRENCY = 8;

function resolveLimitFromArgs(): number | null {
  const args = process.argv.slice(2);
  if (args.includes("--all")) return null;
  const limArg = args.find((a) => a.startsWith("--limit="));
  if (!limArg) return PILOT_SIZE;
  const n = Number.parseInt(limArg.split("=")[1], 10);
  if (!Number.isFinite(n) || n <= 0) return PILOT_SIZE;
  return n;
}

function resolveConcurrencyFromArgs(): number {
  const args = process.argv.slice(2);
  const cArg = args.find((a) => a.startsWith("--concurrency="));
  if (!cArg) return DEFAULT_CONCURRENCY;
  const n = Number.parseInt(cArg.split("=")[1], 10);
  if (!Number.isFinite(n) || n < 1 || n > 40) return DEFAULT_CONCURRENCY;
  return n;
}

function getRequiredEnv(name: string): string {
  const val = process.env[name]?.trim();
  if (!val) throw new Error(`Variable manquante: ${name}`);
  return val;
}

async function humanDelay(): Promise<void> {
  const ms = Math.floor(Math.random() * 3000) + 1000;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSitemapUrls(limit: number | null): Promise<string[]> {
  const max = limit == null ? 2000 : limit;
  return await discoverMotoblouzProductUrls(max);
}

async function run(): Promise<void> {
  const supabase = createClient(
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY")
  );
  const limit = resolveLimitFromArgs();
  const concurrency = resolveConcurrencyFromArgs();
  const urls = await fetchSitemapUrls(limit);
  console.log(`[seed-motoblouz] ${urls.length} URLs récupérées, concurrency=${concurrency}.`);

  let cursor = 0;
  let inserted = 0;
  const failed: Array<{ url: string; reason: string }> = [];
  const toMerge: Array<{
    existingSlug: string;
    candidateSlug: string;
    similarity: number;
    retailer: string;
    url: string;
  }> = [];
  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= urls.length) break;
      const url = urls[index];
      await humanDelay();
      const crawled = await crawlProductUrl(url, "Motoblouz");
      if (!crawled) {
        console.log(`[seed-motoblouz] [${index + 1}/${urls.length}] skip (aucune donnée): ${url}`);
        failed.push({ url, reason: "no_data_or_blocked" });
        continue;
      }
      if (!crawled.category) {
        console.log(`[seed-motoblouz] [${index + 1}/${urls.length}] skip (catégorie inconnue): ${url}`);
        failed.push({ url, reason: "unknown_category" });
        continue;
      }
      if (crawled.isAccessory) {
        console.log(`[seed-motoblouz] [${index + 1}/${urls.length}] skip (accessoire): ${url}`);
        failed.push({ url, reason: "accessory" });
        continue;
      }
      const canonicalSlug = generateCanonicalSlug(crawled.brand, crawled.productName);
      console.log(
        `[MATCHING] Nom site: ${crawled.productName} ---> Slug Universel: ${canonicalSlug}`
      );
      console.log(
        `[MATCH] ${crawled.productName} -> Catégorie : ${crawled.category} (Source: ${crawled.categorySource})`
      );

      const nowIso = new Date().toISOString();
      const { data: existingProduct, error: findErr } = await supabase
        .from("products")
        .select("id")
        .eq("canonical_slug", canonicalSlug)
        .limit(1)
        .maybeSingle();
      if (findErr) {
        failed.push({ url, reason: `lookup_error:${findErr.message}` });
        continue;
      }

      let productId = existingProduct?.id as string | undefined;
      if (!productId) {
        const prefix = canonicalSlug.split("-")[0] ?? canonicalSlug;
        const { data: candidates } = await supabase
          .from("products")
          .select("canonical_slug")
          .ilike("canonical_slug", `${prefix}%`)
          .limit(40);
        const close = (candidates ?? [])
          .map((c) => String(c.canonical_slug ?? ""))
          .find((s) => s && stringSimilarity.compareTwoStrings(s, canonicalSlug) >= 0.9);
        if (close) {
          const similarity = stringSimilarity.compareTwoStrings(close, canonicalSlug);
          console.log(
            `[FUSION?] slug proche detecte (${close}) ~ (${canonicalSlug}) >= 90%`
          );
          toMerge.push({
            existingSlug: close,
            candidateSlug: canonicalSlug,
            similarity,
            retailer: "Motoblouz",
            url,
          });
        }
      }
      if (!productId) {
        const { data: createdProduct, error: createErr } = await supabase
          .from("products")
          .insert({
            ean_code: crawled.eanCode,
            canonical_slug: canonicalSlug,
            brand: crawled.brand,
            model: crawled.model,
            category: crawled.category,
            image_url: null,
            is_accessory: crawled.isAccessory,
            updated_at: nowIso,
          })
          .select("id")
          .single();
        if (createErr || !createdProduct?.id) {
          failed.push({ url, reason: `create_product_error:${createErr?.message ?? "unknown"}` });
          continue;
        }
        productId = createdProduct.id;
      }

      const { error: priceErr } = await supabase
        .from("retailer_prices")
        .upsert(
          {
            product_id: productId,
            retailer_name: "Motoblouz",
            price: crawled.price,
            availability: null,
            url,
            observed_at: nowIso,
          },
          { onConflict: "product_id,retailer_name,url" }
        );
      if (priceErr) {
        failed.push({ url, reason: `retailer_price_error:${priceErr.message}` });
        continue;
      }
      const { data: linkedRetailers } = await supabase
        .from("retailer_prices")
        .select("retailer_name")
        .eq("product_id", productId);
      const distinctRetailers = new Set(
        (linkedRetailers ?? []).map((x) => String(x.retailer_name ?? ""))
      );
      if (distinctRetailers.has("Dafy") && distinctRetailers.has("Motoblouz")) {
        console.log(
          `🎉 RECONCILIATION RÉUSSIE : ${crawled.brand} ${crawled.model} fusionné entre Dafy et Motoblouz`
        );
      }
      inserted += 1;
      console.log(
        `[seed-motoblouz] [${index + 1}/${urls.length}] ok [${crawled.category}] ${crawled.brand} ${crawled.model} (${canonicalSlug})`
      );
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (failed.length > 0) {
    const content = failed.map((f) => `${f.reason}\t${f.url}`).join("\n");
    await writeFile("failed-urls.txt", content, "utf8");
  }
  if (toMerge.length > 0) {
    await mkdir("logs", { recursive: true });
    let existing: unknown[] = [];
    try {
      const raw = await readFile("logs/to-merge.json", "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) existing = parsed;
    } catch {}
    await writeFile(
      "logs/to-merge.json",
      JSON.stringify([...existing, ...toMerge], null, 2),
      "utf8"
    );
  }
  console.log(`[seed-motoblouz] terminé. ${inserted}/${urls.length} fiches insérées/maj.`);
}

run().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[seed-motoblouz] fatal: ${msg}`);
  process.exit(1);
});
