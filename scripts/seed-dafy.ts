import { createClient } from "@supabase/supabase-js";
import { crawlProductUrl } from "../lib/pricing/internal-crawler";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import stringSimilarity from "string-similarity";
import { generateCanonicalSlug } from "../lib/pricing/matcher";

const DAFY_SITEMAP = "https://www.dafy-moto.com/sitemap-produits.xml";
const PILOT_SIZE = 50;
const DEFAULT_CONCURRENCY = 12;
type CatalogCategory =
  | "casque"
  | "blouson"
  | "gants"
  | "bottes"
  | "pantalon";

function parseXmlTagValues(xml: string, tagName: string): string[] {
  const out: string[] = [];
  const rx = new RegExp(`<${tagName}>(.*?)</${tagName}>`, "gims");
  for (const m of xml.matchAll(rx)) {
    const v = (m[1] ?? "").trim();
    if (v) out.push(v);
  }
  return out;
}

function resolveLimitFromArgs(): number | null {
  const args = process.argv.slice(2);
  if (args.includes("--all")) return null;
  const limArg = args.find((a) => a.startsWith("--limit="));
  if (!limArg) return PILOT_SIZE;
  const raw = limArg.split("=")[1];
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return PILOT_SIZE;
  return n;
}

function resolveConcurrencyFromArgs(): number {
  const args = process.argv.slice(2);
  const cArg = args.find((a) => a.startsWith("--concurrency="));
  if (!cArg) return DEFAULT_CONCURRENCY;
  const raw = cArg.split("=")[1];
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 40) return DEFAULT_CONCURRENCY;
  return n;
}

async function fetchSitemapUrls(limit: number | null): Promise<string[]> {
  const res = await fetch(DAFY_SITEMAP, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      referer: "https://www.google.com/",
    },
  });
  if (!res.ok) {
    throw new Error(`Impossible de lire le sitemap Dafy (${res.status})`);
  }
  const xml = await res.text();
  if (/en cours de maintenance/i.test(xml)) {
    console.error("[seed-dafy] Dafy en maintenance, arrêt propre du script.");
    return [];
  }
  const urls = parseXmlTagValues(xml, "loc");
  return limit == null ? urls : urls.slice(0, limit);
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

async function run(): Promise<void> {
  const supabase = createClient(
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY")
  );

  const limit = resolveLimitFromArgs();
  const concurrency = resolveConcurrencyFromArgs();
  const urls = await fetchSitemapUrls(limit);
  if (urls.length === 0) return;
  console.log(
    `[seed-dafy] ${urls.length} URLs récupérées (${limit == null ? "full run" : "pilot run"}), concurrency=${concurrency}.`
  );

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
      try {
        await humanDelay();
        const crawled = await crawlProductUrl(url, "Dafy");
        if (!crawled) {
          console.log(`[seed-dafy] [${index + 1}/${urls.length}] skip (aucune donnée): ${url}`);
          failed.push({ url, reason: "no_data_or_blocked" });
          continue;
        }
        const inferredCategory = crawled.category as CatalogCategory | null;
        if (!inferredCategory) {
          console.log(
            `[seed-dafy] [${index + 1}/${urls.length}] skip (hors scope catégorie): ${url}`
          );
          failed.push({ url, reason: "unknown_category" });
          continue;
        }
        if (crawled.isAccessory) {
          console.log(
            `[seed-dafy] [${index + 1}/${urls.length}] skip (accessoire): ${url}`
          );
          failed.push({ url, reason: "accessory" });
          continue;
        }
        const canonicalSlug = generateCanonicalSlug(crawled.brand, crawled.productName);
        console.log(
          `[MATCHING] Nom site: ${crawled.productName} ---> Slug Universel: ${canonicalSlug}`
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
              retailer: "Dafy",
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
              category: inferredCategory,
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
              retailer_name: "Dafy",
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
          `[seed-dafy] [${index + 1}/${urls.length}] ok [${inferredCategory}] ${crawled.brand} ${crawled.model} (${canonicalSlug})`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[seed-dafy] [${index + 1}/${urls.length}] error: ${msg}`);
      }
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

  console.log(`[seed-dafy] terminé. ${inserted}/${urls.length} fiches insérées/maj.`);
}

run().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[seed-dafy] fatal: ${msg}`);
  process.exit(1);
});
