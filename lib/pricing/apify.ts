import { ApifyClient } from "apify-client";
import {
  listingProductTitle,
  titleMatchesProductListing,
} from "@/lib/pricing/shoppingRelevance";
import type { LivePriceResult } from "@/lib/pricing/livePrice";
import {
  getCachedLivePrice,
  putCachedLivePrice,
  shoppingMedianCacheKey,
} from "@/lib/pricing/shoppingMedianCache";

export type { LivePriceResult } from "@/lib/pricing/livePrice";

/**
 * ID store Apify (voir onglet API / exemple Node.js sur la fiche Actor).
 * Tu peux surcharger avec `APIFY_GOOGLE_SHOPPING_ACTOR_ID` (ex. `burbn/google-shopping-scraper`).
 * @see https://apify.com/burbn/google-shopping-scraper
 */
function getGoogleShoppingActorId(): string {
  return (
    process.env.APIFY_GOOGLE_SHOPPING_ACTOR_ID?.trim() ||
    "JWEHgf5HWeoLlbchr"
  );
}

/** Doit rester ≤ `maxDuration` de `app/api/estimate/route.ts` (ex. 300 s sur Vercel Pro). */
const ACTOR_CALL_WAIT_SECS = 240;
const ACTOR_TIMEOUT_SECS = 270;

/** L’actor exige limit >= 20 ; défaut élevé pour une médiane plus stable. */
const DEFAULT_SHOPPING_LIMIT = 60;

/** On s’arrête si on a assez de prix exploitables après une requête. */
const ENOUGH_PRICES_FOR_SINGLE_QUERY = 8;

/**
 * Nombre max de requêtes Actor par estimation (facturées chacune).
 * Défaut 1 = le plus économique ; `APIFY_MAX_QUERY_VARIANTS=3` pour retrouver plus de recul.
 */
function getMaxQueryVariants(): number {
  const raw = process.env.APIFY_MAX_QUERY_VARIANTS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 1 && n <= 8) return n;
  return 1;
}

/**
 * Surcharge : `APIFY_GOOGLE_SHOPPING_LIMIT` (entier 20–100).
 */
function getShoppingResultLimit(): number {
  const raw = process.env.APIFY_GOOGLE_SHOPPING_LIMIT?.trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 20 && n <= 100) return n;
  return DEFAULT_SHOPPING_LIMIT;
}

/**
 * Plafond facturable Apify (résultats dataset) : obligatoire pour les Actors
 * pay-per-result / PPE avec événement `apify-default-dataset-item`. Sans `maxItems`,
 * la plateforme renvoie : « Maximum charged results must be greater than zero ».
 * Doit être aligné avec `input.limit` (schéma burbn : 20–100).
 */
function clampChargedDatasetItems(limit: number): number {
  const n = Math.round(Number(limit));
  if (!Number.isFinite(n)) return DEFAULT_SHOPPING_LIMIT;
  return Math.min(100, Math.max(20, n));
}

/**
 * Plafond de coût USD pour Actors pay-per-event (optionnel mais recommandé).
 */
function getMaxTotalChargeUsd(): number | undefined {
  const raw = process.env.APIFY_MAX_TOTAL_CHARGE_USD?.trim();
  if (!raw) return undefined;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

/** Filtre erreurs d’extraction / accessoires hors sujet (large pour ne pas couper le haut de gamme). */
function retailBoundsEur(category: string): { min: number; max: number } {
  switch (category) {
    case "casque":
      return { min: 15, max: 3500 };
    case "blouson":
    case "pantalon":
      return { min: 25, max: 5000 };
    case "gants":
      return { min: 8, max: 1200 };
    case "bottes":
      return { min: 20, max: 2500 };
    default:
      return { min: 5, max: 8000 };
  }
}

/** Synonyme court pour élargir le rappel Google sans tout changer. */
const CATEGORY_SEARCH_HINT: Record<string, string> = {
  casque: "casque moto",
  blouson: "blouson moto",
  pantalon: "pantalon moto",
  gants: "gants moto",
  bottes: "bottes moto",
};

/**
 * Du plus précis au plus large : avec déclinaison, on injecte d’abord « modèle + déclinaison » dans la requête,
 * puis des requêtes sans déclinaison pour le rappel (le filtre titre écarte les annonces hors fiche).
 */
function buildSearchQueryVariants(
  brand: string,
  model: string,
  category: string,
  declinaison?: string
): string[] {
  const b = brand.trim();
  const m = model.trim();
  const d = declinaison?.trim() ?? "";
  const cat = category.trim().toLowerCase();
  const hint = CATEGORY_SEARCH_HINT[cat] ?? cat;
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (parts: string[]) => {
    const q = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (q.length < 3 || seen.has(q)) return;
    seen.add(q);
    out.push(q);
  };

  const modelFull = d ? `${m} ${d}`.trim() : m;

  add([b, modelFull, cat]);
  add([b, modelFull, hint]);
  add([b, modelFull]);
  const fullHasBrand =
    modelFull.toLowerCase().startsWith(b.toLowerCase()) ||
    modelFull.toLowerCase().includes(` ${b.toLowerCase()}`);
  if (!fullHasBrand) add([modelFull, cat]);
  add([modelFull]);

  if (d) {
    add([b, m, cat]);
    add([b, m, hint]);
    add([b, m]);
    const mHasBrand =
      m.toLowerCase().startsWith(b.toLowerCase()) ||
      m.toLowerCase().includes(` ${b.toLowerCase()}`);
    if (!mHasBrand) add([m, cat]);
    add([m]);
  } else if (!fullHasBrand) {
    add([m, cat]);
    add([m]);
  }

  return out;
}

function parseEuroValue(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  if (typeof raw !== "string") return null;
  let t = raw.replace(/[\u00a0\u202f]/g, " ").trim();
  t = t.replace(/[$€£]|EUR|eur|USD|usd/gi, "").trim();
  t = t.replace(/\s/g, "");
  const lastComma = t.lastIndexOf(",");
  const lastDot = t.lastIndexOf(".");
  if (lastComma > lastDot) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma && lastComma !== -1) {
    t = t.replace(/,/g, "");
  } else if (lastComma !== -1) {
    t = t.replace(",", ".");
  }
  const m = t.match(/(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseTypicalPriceRange(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const nums: number[] = [];
  for (const m of raw.matchAll(/(\d+(?:[.,]\d{1,2})?)/g)) {
    const n = Number.parseFloat(m[1].replace(",", "."));
    if (Number.isFinite(n) && n > 0) nums.push(n);
  }
  if (nums.length === 0) return null;
  if (nums.length === 1) return nums[0];
  const a = Math.min(...nums);
  const b = Math.max(...nums);
  return Math.round(((a + b) / 2) * 100) / 100;
}

const PRICE_KEYS = [
  "price",
  "extractedPrice",
  "originalPrice",
  "currentPrice",
  "salePrice",
  "formattedPrice",
  "displayPrice",
  "priceWithCurrency",
  "minPrice",
  "maxPrice",
] as const;

const LISTING_PRICE_KEYS = [
  "price",
  "extractedPrice",
  "currentPrice",
  "salePrice",
  "formattedPrice",
  "displayPrice",
  "priceWithCurrency",
  "minPrice",
] as const;

const SCAN_SKIP_KEY =
  /^(productId|productTitle|productDescription|productPageUrl|storeName|shipping|returns|payment|productPhotos|productVideos|url|href|favicon|thumbnail)$/i;

function parseNestedMoney(val: unknown): number | null {
  if (val == null) return null;
  if (typeof val !== "object" || Array.isArray(val)) return null;
  const o = val as Record<string, unknown>;
  return (
    parseEuroValue(o.value) ??
    parseEuroValue(o.amount) ??
    parseEuroValue(o.text) ??
    parseEuroValue(o.display) ??
    parseEuroValue(o.formatted) ??
    null
  );
}

function scanValuesForPrice(obj: unknown, depth: number): number | null {
  if (depth > 5 || obj == null) return null;
  if (typeof obj === "string") {
    if (!/\d/.test(obj)) return null;
    if (
      /€|EUR|eur|\$\s*\d|\d+[.,]\d{2}/.test(obj) ||
      /^\s*\d{2,4}([.,]\d{1,2})?\s*$/.test(obj)
    ) {
      return parseEuroValue(obj);
    }
    return null;
  }
  if (typeof obj === "number") return null;
  if (Array.isArray(obj)) {
    for (const el of obj) {
      const p = scanValuesForPrice(el, depth + 1);
      if (p != null) return p;
    }
    return null;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (SCAN_SKIP_KEY.test(k)) continue;
      if (/rating|reviews?|numreviews|stars?$/i.test(k)) continue;
      const p =
        typeof v === "object" && v !== null && !Array.isArray(v)
          ? parseNestedMoney(v) ?? scanValuesForPrice(v, depth + 1)
          : scanValuesForPrice(v, depth + 1);
      if (p != null) return p;
    }
  }
  return null;
}

function parseFirstPriceFromKeys(
  item: Record<string, unknown>,
  keys: readonly string[]
): number | null {
  for (const key of keys) {
    const raw = item[key];
    const v = parseEuroValue(raw) ?? parseNestedMoney(raw);
    if (v != null) return v;
  }
  return null;
}

function extractPriceFromItem(item: Record<string, unknown>): number | null {
  for (const key of PRICE_KEYS) {
    const raw = item[key];
    const v = parseEuroValue(raw);
    if (v != null) return v;
    const nested = parseNestedMoney(raw);
    if (nested != null) return nested;
  }

  const range = parseTypicalPriceRange(item.typicalPriceRange);
  if (range != null) return range;

  const nestedPrice = item.price as Record<string, unknown> | undefined;
  if (nestedPrice && typeof nestedPrice === "object" && !Array.isArray(nestedPrice)) {
    const v =
      parseNestedMoney(nestedPrice) ?? parseEuroValue(nestedPrice);
    if (v != null) return v;
  }

  return scanValuesForPrice(item, 0);
}

/**
 * Estimation « prix neuf » pour une ligne : prix affiché vs prix barré / fourchette → on prend le plus haut signal crédible.
 */
function extractRetailNeufFromItem(item: Record<string, unknown>): number | null {
  const listing = parseFirstPriceFromKeys(item, LISTING_PRICE_KEYS);
  const strikethrough = parseFirstPriceFromKeys(item, ["originalPrice"]);
  const rangeMid = parseTypicalPriceRange(item.typicalPriceRange);

  const candidates = [listing, strikethrough, rangeMid].filter(
    (x): x is number => x != null && Number.isFinite(x)
  );
  if (candidates.length >= 2) {
    return Math.max(...candidates);
  }
  if (candidates.length === 1) return candidates[0];

  return extractPriceFromItem(item);
}

function medianPlain(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const med =
    sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(med * 100) / 100;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Médiane après filtrage Tukey (IQR) : atténue une poignée d’annonces aberrantes.
 * Si le filtre vide trop de points, on retombe sur la série complète.
 */
function robustMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  if (values.length <= 2) return medianPlain(values);

  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;

  if (!(iqr > 0)) {
    return medianPlain(sorted);
  }

  const low = q1 - 1.5 * iqr;
  const high = q3 + 1.5 * iqr;
  const filtered = sorted.filter((p) => p >= low && p <= high);
  const minKeep = Math.max(3, Math.ceil(sorted.length * 0.4));
  const use = filtered.length >= minKeep ? filtered : sorted;
  return medianPlain(use);
}

function computeLiveConfidence(
  prices: number[],
  median: number
): Pick<LivePriceResult, "confidence" | "needsReview" | "sourcesFound"> {
  const n = prices.length;
  const needsReview = n < 3;
  let confidence = Math.min(100, Math.round(32 + n * 16));
  if (n >= 6) confidence = Math.min(100, confidence + 8);
  if (n >= 10) confidence = Math.min(100, confidence + 4);
  if (needsReview) confidence = Math.min(confidence, 50);

  if (n >= 3 && median > 0) {
    const sorted = [...prices].sort((a, b) => a - b);
    const spread = (sorted[sorted.length - 1] - sorted[0]) / median;
    if (spread > 0.4) confidence -= 12;
    else if (spread > 0.25) confidence -= 6;
  }

  return {
    sourcesFound: n,
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    needsReview,
  };
}

function collectPricesFromDataset(
  items: Record<string, unknown>[],
  category: string,
  brand: string,
  model: string,
  declinaison?: string
): number[] {
  const { min, max } = retailBoundsEur(category);
  const thresholds = declinaison?.trim()
    ? [0.88, 0.74, 0.6]
    : [0.74, 0.6, 0.48];

  const collectAtRatio = (minRatio: number): number[] => {
    const prices: number[] = [];
    for (const row of items) {
      const title = listingProductTitle(row);
      if (
        !titleMatchesProductListing(title, brand, model, declinaison, minRatio)
      ) {
        continue;
      }
      const p = extractRetailNeufFromItem(row);
      if (p == null || !Number.isFinite(p)) continue;
      if (p < min || p > max) continue;
      prices.push(p);
    }
    return prices;
  };

  for (const minRatio of thresholds) {
    const prices = collectAtRatio(minRatio);
    if (prices.length >= 3) return prices;
  }
  return collectAtRatio(thresholds[thresholds.length - 1]);
}

/**
 * Prix médian robuste via Google Shopping (variantes de requête, IQR, ancrage neuf).
 * Erreur / token absent → `null`.
 */
export async function fetchLivePrice(
  brand: string,
  model: string,
  category: string,
  declinaison?: string
): Promise<LivePriceResult | null> {
  try {
    const token =
      process.env.APIFY_API_TOKEN?.trim() || process.env.APIFY_TOKEN?.trim();
    if (!token) {
      console.warn(
        "[apify] APIFY_API_TOKEN (ou APIFY_TOKEN) manquant — skip Google Shopping."
      );
      return null;
    }

    const limit = clampChargedDatasetItems(getShoppingResultLimit());
    const actorId = getGoogleShoppingActorId();
    const maxTotalChargeUsd = getMaxTotalChargeUsd();
    const cacheKey = shoppingMedianCacheKey({
      brand,
      model,
      category,
      declinaison,
      actorId,
      limit,
    });

    const cached = await getCachedLivePrice(cacheKey);
    if (cached != null) {
      console.log(
        "[apify] Médiane depuis cache Supabase EUR=%s (pas de run Actor)",
        cached.price
      );
      return cached;
    }

    const client = new ApifyClient({ token });
    const variants = buildSearchQueryVariants(
      brand,
      model,
      category,
      declinaison
    );
    const maxVariants = Math.min(variants.length, getMaxQueryVariants());

    const mergedPrices: number[] = [];
    let lastRowCount = 0;
    let lastRunId = "";

    for (let i = 0; i < Math.min(variants.length, maxVariants); i++) {
      const searchQuery = variants[i];

      if (i === 0) {
        console.log(
          "[apify] Google Shopping | actor=%s | limit=%s | requêtes max=%s / %s libellés",
          actorId,
          limit,
          maxVariants,
          variants.length
        );
      }
      console.log("[apify] Requête [%s/%s] %j", i + 1, variants.length, searchQuery);

      const input = {
        searchQuery,
        country: "fr",
        language: "fr",
        limit,
        sortBy: "BEST_MATCH" as const,
      };

      const run = await client.actor(actorId).call(input, {
        waitSecs: ACTOR_CALL_WAIT_SECS,
        timeout: ACTOR_TIMEOUT_SECS,
        /** Pay-per-result / PPE dataset-item : requis pour que le run démarre. */
        maxItems: limit,
        ...(maxTotalChargeUsd != null
          ? { maxTotalChargeUsd }
          : {}),
      });

      lastRunId = run.id ?? "";

      if (run.status !== "SUCCEEDED" || !run.defaultDatasetId) {
        console.warn(
          "[apify] Run non abouti (variante %s): %s %s",
          searchQuery,
          run.status,
          lastRunId
        );
        continue;
      }

      const { items } = await client
        .dataset(run.defaultDatasetId)
        .listItems({ limit: Math.max(limit, 100) });

      const rows = (items ?? []) as Record<string, unknown>[];
      lastRowCount = rows.length;

      if (rows.length === 0) {
        console.log(
          "[apify] Dataset vide | query=%s | run=%s",
          searchQuery,
          lastRunId
        );
        continue;
      }

      const batch = collectPricesFromDataset(
        rows,
        category,
        brand,
        model,
        declinaison
      );
      mergedPrices.push(...batch);

      console.log(
        "[apify] Variante %j → lignes=%s prix titre-filtrés=%s | cumul=%s | déclinaison=%j",
        searchQuery,
        rows.length,
        batch.length,
        mergedPrices.length,
        declinaison?.trim() || null
      );

      if (mergedPrices.length >= ENOUGH_PRICES_FOR_SINGLE_QUERY) {
        break;
      }
    }

    if (mergedPrices.length === 0) {
      console.log(
        "[apify] Aucun prix exploitable après %s variante(s) | dernières lignes dataset≈%s | run=%s",
        Math.min(variants.length, maxVariants),
        lastRowCount,
        lastRunId
      );
      return null;
    }

    const median = robustMedian(mergedPrices);
    if (median == null) return null;

    const { confidence, needsReview, sourcesFound } = computeLiveConfidence(
      mergedPrices,
      median
    );
    const result: LivePriceResult = {
      price: median,
      confidence,
      sourcesFound,
      needsReview,
    };

    console.log(
      "[apify] Médiane robuste EUR=%s | n=%s | confiance=%s | review=%s | actor=%s",
      median,
      sourcesFound,
      confidence,
      needsReview,
      actorId
    );

    await putCachedLivePrice(cacheKey, result);

    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("proxy-agent")) {
      console.error(
        "[apify] Dépendance manquante ou non résolue par Next (proxy-agent). " +
          "Installez `proxy-agent` et listez `apify-client` dans `serverExternalPackages` (next.config)."
      );
    }
    if (
      msg.includes("charged results") ||
      msg.includes("maxItems") ||
      msg.includes("input.limit") ||
      msg.includes("Input is not valid")
    ) {
      console.error(
        "[apify] Entrée ou plafond run refusé — vérifiez input.limit (20–100) et options.maxItems. Limit=%s",
        clampChargedDatasetItems(getShoppingResultLimit())
      );
    }
    console.warn("[apify] Erreur Google Shopping:", msg);
    return null;
  }
}
