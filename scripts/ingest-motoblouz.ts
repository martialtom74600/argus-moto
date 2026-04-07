import { createClient } from "@supabase/supabase-js";
import {
  MOTOBLOUZ_DEFAULT_SITEMAP_INDEX,
  collectMotoblouzUrlsFromSitemap,
  collectMotoblouzUrlsFromSitemapIndex,
  fetchMotoblouzProductPage,
  fetchMotoblouzProductUrlsFromSitemap,
  fetchMotoblouzProductUrlsFromSitemapIndex,
  parseMotoblouzHtmlResult,
  resolveMotoblouzProductSitemapUrls,
  upsertMotoblouzProduct,
} from "../lib/ingestion/motoblouz-simple";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Variable manquante: ${name}`);
  return v;
}

function getNumArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`${name}=`));
  if (!raw) return fallback;
  const n = Number.parseInt(raw.split("=")[1] ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

function getStrArg(name: string, fallback: string): string {
  const raw = process.argv.find((a) => a.startsWith(`${name}=`));
  if (!raw) return fallback;
  const v = raw.slice(name.length + 1).trim();
  return v || fallback;
}

function parseCli() {
  const all = process.argv.includes("--all");
  const limitRaw = getNumArg("--limit", 100);
  const limit = all ? Number.MAX_SAFE_INTEGER : Math.max(1, limitRaw);
  const skip = Math.max(0, getNumArg("--skip", 0));
  const concurrency = Math.min(
    16,
    Math.max(1, getNumArg("--concurrency", 4))
  );
  const delayMin = Math.max(0, getNumArg("--delay-min", 350));
  const delayMax = Math.max(
    delayMin,
    getNumArg("--delay-max", 750)
  );
  const collectWear = process.argv.includes("--collect-wear");
  const sitemapIndexUrl = getStrArg(
    "--sitemap-index",
    MOTOBLOUZ_DEFAULT_SITEMAP_INDEX
  );
  const sitemapArg = process.argv.find((a) => a.startsWith("--sitemap="));
  const singleSitemapUrl = sitemapArg
    ? sitemapArg.slice("--sitemap=".length).trim()
    : "";
  return {
    limit,
    skip,
    concurrency,
    delayMin,
    delayMax,
    collectWear,
    sitemapIndexUrl,
    singleSitemapUrl,
    all,
  };
}

function jitterDelay(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const {
    limit,
    skip,
    concurrency,
    delayMin,
    delayMax,
    collectWear,
    sitemapIndexUrl,
    singleSitemapUrl,
    all,
  } = parseCli();

  const indexMode = singleSitemapUrl.length === 0;

  if (skip > 0 && !collectWear && !indexMode) {
    console.warn(
      "[ingest-motoblouz] Les tranches « brutes » d’un seul fichier product sont souvent des pièces.\n" +
        "            Préférez l’index (--sitemap-index par défaut) et/ou --collect-wear.\n"
    );
  }

  if (all && !collectWear) {
    console.warn(
      "[ingest-motoblouz] --all sans --collect-wear va tenter la majorité des URLs (pièces / accessoires).\n" +
        "            La plupart seront en SKIP. Pour l’équipement pilote : ajoutez --collect-wear.\n"
    );
  }

  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY")
  );

  let urls: string[];

  if (indexMode) {
    const productFiles = await resolveMotoblouzProductSitemapUrls(
      sitemapIndexUrl
    );
    console.log(
      `[ingest-motoblouz] Index : ${sitemapIndexUrl}\n` +
        `            → ${productFiles.length} fichier(s) sitemap-product-*.xml\n`
    );

    const collectOpts =
      all
        ? { skipEntries: skip, maxScanAfterSkip: Number.MAX_SAFE_INTEGER }
        : { skipEntries: skip };

    urls = collectWear
      ? await collectMotoblouzUrlsFromSitemapIndex(sitemapIndexUrl, limit, {
          ...collectOpts,
        })
      : await fetchMotoblouzProductUrlsFromSitemapIndex(
          sitemapIndexUrl,
          limit,
          skip
        );
  } else {
    urls = collectWear
      ? await collectMotoblouzUrlsFromSitemap(singleSitemapUrl, limit, {
          skipEntries: skip,
          ...(all
            ? { maxScanAfterSkip: Number.MAX_SAFE_INTEGER }
            : {}),
        })
      : await fetchMotoblouzProductUrlsFromSitemap(
          singleSitemapUrl,
          limit,
          skip
        );
  }

  if (urls.length === 0) {
    console.error(
      collectWear
        ? `Aucune URL équipement collectée (skip trop grand ou prédicat trop strict).`
        : "Aucune URL trouvée (skip trop grand ou index vide ?)."
    );
    process.exit(1);
  }

  const total = urls.length;
  console.log(
    `[ingest-motoblouz] ${total} URLs à traiter` +
      (collectWear ? " (mode --collect-wear)" : "") +
      (all ? " (--all)" : "") +
      ` · concurrence=${concurrency} · délai ${delayMin}-${delayMax}ms\n`
  );

  let cursor = 0;
  let okCount = 0;

  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= urls.length) break;
      const url = urls[i]!;
      const batchNum = i + 1;

      await sleep(jitterDelay(delayMin, delayMax));

      let html: string;
      try {
        html = await fetchMotoblouzProductPage(url);
      } catch (e) {
        console.log(
          `[${batchNum}/${total}] [SKIP] ${e instanceof Error ? e.message : String(e)}`
        );
        continue;
      }

      const parsed = parseMotoblouzHtmlResult(html, url);
      if (!parsed.ok) {
        if (parsed.reason === "accessory") {
          console.log(`[${batchNum}/${total}] [SKIP] Accessoire détecté`);
        } else if (parsed.reason === "no_price") {
          console.log(
            `[${batchNum}/${total}] [SKIP] Pas de prix (souvent rupture)`
          );
        } else {
          console.log(
            `[${batchNum}/${total}] [SKIP] Extraction (${parsed.reason})`
          );
        }
        continue;
      }

      try {
        await upsertMotoblouzProduct(supabase, parsed.data, url);
      } catch (e) {
        console.log(
          `[${batchNum}/${total}] [ERR] ${e instanceof Error ? e.message : String(e)}`
        );
        continue;
      }

      okCount += 1;
      const { brand, model, price, category } = parsed.data;
      console.log(
        `[${batchNum}/${total}] - ${brand} ${model} - ${price}€ - Cat: ${category}`
      );
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  console.log(
    `\n[ingest-motoblouz] terminé · ${okCount} produits enregistrés sur ${total} URLs traitées.`
  );
  if (okCount === 0 && !collectWear) {
    console.warn(
      "\nAstuce : relancez avec --collect-wear pour ne parcourir que les slugs casque / textile / pantalon / gants / bottes."
    );
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
