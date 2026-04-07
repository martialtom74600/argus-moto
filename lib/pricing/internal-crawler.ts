import type { LivePriceResult } from "@/lib/pricing/livePrice";
import stringSimilarity from "string-similarity";
import { calculateCleanMedian } from "@/lib/pricing/engine";
import { mapCategoryAndAccessory } from "@/lib/ingestion/category-mapper";

type RetailerName = "Dafy" | "Motoblouz" | "FC-Moto";

type RetailerConfig = {
  name: RetailerName;
  sourceLabel: string;
  sitemapUrls: string[];
};

export type InternalCrawlerResult = LivePriceResult & {
  retailerSource: string;
  isOfficialFeed: boolean;
};
export type CrawledProductRecord = {
  productUrl: string;
  brand: string;
  model: string;
  productName: string;
  eanCode: string | null;
  price: number;
  category: "casque" | "blouson" | "gants" | "bottes" | "pantalon" | null;
  categorySource: "Breadcrumb" | "Title" | "Unknown";
  isAccessory: boolean;
  retailerSource: string;
  isOfficialFeed: boolean;
};

export type CrawledProductDebug = {
  url: string;
  retailerSource: string;
  httpStatus: number;
  jsonLdBlockCount: number;
  jsonLdTypes: string[];
  breadcrumbLabels: string[];
  detectedCategory: "casque" | "blouson" | "gants" | "bottes" | "pantalon" | null;
  categorySource: "Breadcrumb" | "Title" | "Unknown";
  isAccessory: boolean;
  candidates: Array<{
    title: string;
    price: number;
    eanCode: string | null;
    brand: string | null;
    similarityToQuery: number | null;
  }>;
  filteredInCount: number;
  skippedReason: string | null;
};

const RETAILERS: RetailerConfig[] = [
  {
    name: "Dafy",
    sourceLabel: "Dafy",
    sitemapUrls: ["https://www.dafy-moto.com/sitemap.xml"],
  },
  {
    name: "Motoblouz",
    sourceLabel: "Motoblouz",
    sitemapUrls: ["https://www.motoblouz.com/sitemap.xml"],
  },
  {
    name: "FC-Moto",
    sourceLabel: "FC-Moto",
    sitemapUrls: ["https://www.fc-moto.de/sitemap.xml"],
  },
];

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_URLS_PER_RETAILER = 120;
const MIN_PRODUCT_SIMILARITY = 0.8;
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function isMockModeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_USE_MOCK_DATA?.trim() === "true";
}

function buildNeedle(brand: string, model: string, declinaison?: string): string[] {
  const base = `${brand} ${model} ${declinaison ?? ""}`
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return base.split(" ").filter((p) => p.length >= 2);
}

function detectEan(text: string): string | null {
  const m = text.match(/\b\d{8,14}\b/);
  return m ? m[0] : null;
}

async function fetchText(url: string): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ac.signal,
      headers: {
        "user-agent": CHROME_UA,
        referer: "https://www.google.com/",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextDetailed(url: string): Promise<{
  ok: boolean;
  status: number;
  text: string;
}> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ac.signal,
      headers: {
        "user-agent": CHROME_UA,
        referer: "https://www.google.com/",
      },
      cache: "no-store",
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch {
    return { ok: false, status: 0, text: "" };
  } finally {
    clearTimeout(timer);
  }
}

function extractXmlTagValues(xml: string, tagName: string): string[] {
  const out: string[] = [];
  const rx = new RegExp(`<${tagName}>(.*?)</${tagName}>`, "gims");
  for (const m of xml.matchAll(rx)) {
    const raw = (m[1] ?? "").trim();
    if (raw) out.push(raw);
  }
  return out;
}

function extractJsonLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  const rx =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gim;
  for (const m of html.matchAll(rx)) {
    const block = (m[1] ?? "").trim();
    if (block) blocks.push(block);
  }
  return blocks;
}

function flattenJsonLdNodes(block: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  try {
    const parsed = JSON.parse(block) as unknown;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      if (Array.isArray(obj["@graph"])) {
        for (const g of obj["@graph"]) {
          if (g && typeof g === "object") out.push(g as Record<string, unknown>);
        }
      } else {
        out.push(obj);
      }
    }
  } catch {
    return [];
  }
  return out;
}

function mapCategoryFromTokens(tokens: string[]): {
  category: "casque" | "blouson" | "gants" | "bottes" | "pantalon" | null;
  isAccessory: boolean;
} {
  return mapCategoryAndAccessory(tokens);
}

function parseBreadcrumbInfo(blocks: string[]): {
  category: "casque" | "blouson" | "gants" | "bottes" | "pantalon" | null;
  isAccessory: boolean;
  breadcrumbLabels: string[];
} {
  const labels: string[] = [];
  for (const block of blocks) {
    const nodes = flattenJsonLdNodes(block);
    for (const node of nodes) {
      const type = String(node["@type"] ?? "").toLowerCase();
      if (!type.includes("breadcrumblist")) continue;
      const items = Array.isArray(node.itemListElement)
        ? node.itemListElement
        : [];
      for (const it of items) {
        if (!it || typeof it !== "object") continue;
        const obj = it as Record<string, unknown>;
        if (typeof obj.name === "string" && obj.name.trim()) {
          labels.push(obj.name.trim());
        }
      }
    }
  }
  const mapped = mapCategoryFromTokens(labels);
  return { ...mapped, breadcrumbLabels: labels };
}

function jsonLdTypesFromBlock(block: string): string[] {
  const nodes = flattenJsonLdNodes(block);
  const out: string[] = [];
  for (const n of nodes) {
    const t = n["@type"];
    if (Array.isArray(t)) {
      for (const x of t) if (typeof x === "string") out.push(x);
    } else if (typeof t === "string") {
      out.push(t);
    }
  }
  return out;
}

function parseJsonLdPrices(
  block: string
): { title: string; price: number; eanCode: string | null; brand: string | null }[] {
  const out: { title: string; price: number; eanCode: string | null; brand: string | null }[] = [];
  try {
    const parsed = JSON.parse(block) as unknown;
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const o = node as Record<string, unknown>;
      const nodeType = String(o["@type"] ?? "").toLowerCase();
      if (!nodeType.includes("product")) continue;

      const title = typeof o.name === "string" ? o.name : "";
      const eanCode =
        (typeof o.gtin13 === "string" && o.gtin13.trim()) ||
        (typeof o.gtin === "string" && o.gtin.trim()) ||
        (typeof o.ean === "string" && o.ean.trim()) ||
        null;
      let brand: string | null = null;
      if (typeof o.brand === "string") brand = o.brand.trim() || null;
      if (!brand && typeof o.brand === "object" && o.brand) {
        const bObj = o.brand as Record<string, unknown>;
        if (typeof bObj.name === "string") brand = bObj.name.trim() || null;
      }
      const offers = o.offers;
      const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];
      for (const offer of offerList) {
        if (!offer || typeof offer !== "object") continue;
        const priceRaw = (offer as Record<string, unknown>).price;
        const n =
          typeof priceRaw === "number"
            ? priceRaw
            : typeof priceRaw === "string"
              ? Number.parseFloat(priceRaw.replace(",", "."))
              : NaN;
        if (Number.isFinite(n) && n > 0) {
          out.push({ title, price: n, eanCode, brand });
        }
      }
    }
  } catch {
    return out;
  }
  return out;
}

async function crawlRetailer(
  retailer: RetailerConfig,
  needles: string[],
  modelQuery: string,
  queryEan: string | null,
  targetCategory: string
): Promise<{ prices: number[]; eanMatched: boolean }> {
  const prices: number[] = [];
  let eanMatched = false;
  for (const sitemapUrl of retailer.sitemapUrls) {
    const xml = await fetchText(sitemapUrl);
    if (!xml) continue;

    const locs = extractXmlTagValues(xml, "loc").slice(0, MAX_URLS_PER_RETAILER);
    for (const productUrl of locs) {
      const lowUrl = productUrl.toLowerCase();
      if (!needles.some((n) => lowUrl.includes(n))) continue;

      const item = await crawlProductUrl(
        productUrl,
        retailer.sourceLabel,
        modelQuery,
        queryEan
      );
      if (!item) continue;
      if (item.isAccessory) continue;
      if (item.category !== targetCategory) continue;
      if (queryEan && item.eanCode === queryEan) eanMatched = true;
      const haystack = `${item.brand} ${item.model}`.toLowerCase();
      if (!needles.some((n) => haystack.includes(n))) {
        const score = stringSimilarity.compareTwoStrings(
          modelQuery.toLowerCase(),
          haystack
        );
        if (score < MIN_PRODUCT_SIMILARITY) continue;
      }
      prices.push(item.price);
    }
  }
  return { prices, eanMatched };
}

export async function fetchInternalCrawlerPrice(
  brand: string,
  model: string,
  category: string,
  declinaison?: string
): Promise<InternalCrawlerResult | null> {
  if (isMockModeEnabled()) {
    return {
      price: 349,
      confidence: 88,
      sourcesFound: 7,
      needsReview: false,
      retailerSource: "Mock Data Lake",
      isOfficialFeed: true,
    };
  }

  const needles = buildNeedle(brand, model, declinaison);
  const modelQuery = [brand, model, declinaison].filter(Boolean).join(" ").trim();
  const queryEan = detectEan(modelQuery);
  if (needles.length < 2) return null;

  const byRetailer = await Promise.all(
    RETAILERS.map(async (retailer) => ({
      retailer,
      crawl: await crawlRetailer(
        retailer,
        needles,
        modelQuery,
        queryEan,
        category.toLowerCase()
      ),
    }))
  );

  const anyExactEanMatch = byRetailer.some((x) => x.crawl.eanMatched);
  const allPrices = byRetailer.flatMap((x) => x.crawl.prices);
  const cleaned = calculateCleanMedian(allPrices);
  const med = cleaned.median;
  if (med == null) return null;

  const bestRetailer =
    byRetailer.sort((a, b) => b.crawl.prices.length - a.crawl.prices.length)[0]
      ?.retailer ??
    RETAILERS[0];

  return {
    price: med,
    confidence: anyExactEanMatch ? 100 : cleaned.confidenceScore,
    sourcesFound: cleaned.validCount,
    needsReview:
      !anyExactEanMatch &&
      (cleaned.confidenceScore < 70 || cleaned.validCount < 3),
    retailerSource: bestRetailer.sourceLabel,
    isOfficialFeed: true,
  };
}

export function isExternalMarketDisabled(): boolean {
  return isMockModeEnabled();
}

export async function crawlProductUrl(
  productUrl: string,
  retailerSource = "Dafy",
  modelQuery = "",
  queryEan: string | null = null
): Promise<CrawledProductRecord | null> {
  if (isMockModeEnabled()) {
    return {
      productUrl,
      brand: "mock-brand",
      model: "mock-model",
      productName: "mock-product",
      eanCode: "0000000000000",
      price: 299,
      category: "casque",
      categorySource: "Breadcrumb",
      isAccessory: false,
      retailerSource,
      isOfficialFeed: true,
    };
  }

  const html = await fetchText(productUrl);
  if (!html) return null;
  const blocks = extractJsonLdBlocks(html);
  const parsed = blocks.flatMap((b) => parseJsonLdPrices(b));
  if (parsed.length === 0) return null;
  const breadcrumb = parseBreadcrumbInfo(blocks);

  const filtered = parsed.filter((p) => {
    if (queryEan && p.eanCode === queryEan) return true;
    if (!modelQuery.trim()) return true;
    const score = stringSimilarity.compareTwoStrings(
      modelQuery.toLowerCase(),
      p.title.toLowerCase()
    );
    return score >= MIN_PRODUCT_SIMILARITY;
  });
  if (filtered.length === 0) return null;
  const prices = filtered
    .map((p) => p.price)
    .filter((p) => Number.isFinite(p) && p > 0);
  const price = calculateCleanMedian(prices).median;
  if (price == null) return null;

  const exactByEan = queryEan
    ? filtered.find((p) => p.eanCode === queryEan)
    : undefined;
  const best = exactByEan ?? filtered[0];
  const title = (best.title || "").trim();
  const words = title.split(/\s+/).filter(Boolean);
  const fallbackBrand = best.brand ?? words[0] ?? "unknown";
  const fallbackModel = words.slice(1).join(" ") || "unknown-model";
  const titleMapped = mapCategoryFromTokens([title]);
  let finalCategory: "casque" | "blouson" | "gants" | "bottes" | "pantalon" | null = null;
  let categorySource: "Breadcrumb" | "Title" | "Unknown" = "Unknown";
  if (breadcrumb.category) {
    finalCategory = breadcrumb.category;
    categorySource = "Breadcrumb";
  } else if (titleMapped.category) {
    finalCategory = titleMapped.category;
    categorySource = "Title";
  }
  const isAccessory = breadcrumb.isAccessory || titleMapped.isAccessory;

  const displayName = title || `${fallbackBrand} ${fallbackModel}`.trim();

  return {
    productUrl,
    brand: (best.brand ?? fallbackBrand).trim() || "unknown",
    model: displayName,
    productName: displayName,
    eanCode: best.eanCode,
    price,
    category: finalCategory,
    categorySource,
    isAccessory,
    retailerSource,
    isOfficialFeed: true,
  };
}

export async function inspectProductUrl(
  productUrl: string,
  retailerSource = "Unknown",
  modelQuery = "",
  queryEan: string | null = null
): Promise<CrawledProductDebug> {
  const fetched = await fetchTextDetailed(productUrl);
  if (!fetched.ok) {
    return {
      url: productUrl,
      retailerSource,
      httpStatus: fetched.status,
      jsonLdBlockCount: 0,
      jsonLdTypes: [],
      breadcrumbLabels: [],
      detectedCategory: null,
      categorySource: "Unknown",
      isAccessory: false,
      candidates: [],
      filteredInCount: 0,
      skippedReason: fetched.status === 0 ? "network_error" : `http_${fetched.status}`,
    };
  }

  const blocks = extractJsonLdBlocks(fetched.text);
  const breadcrumb = parseBreadcrumbInfo(blocks);
  const parsed = blocks.flatMap((b) => parseJsonLdPrices(b));
  const candidates = parsed.map((p) => {
    const sim =
      modelQuery.trim().length > 0
        ? stringSimilarity.compareTwoStrings(modelQuery.toLowerCase(), p.title.toLowerCase())
        : null;
    return {
      title: p.title,
      price: p.price,
      eanCode: p.eanCode,
      brand: p.brand,
      similarityToQuery: sim,
    };
  });
  const filtered = parsed.filter((p) => {
    if (queryEan && p.eanCode === queryEan) return true;
    if (!modelQuery.trim()) return true;
    const score = stringSimilarity.compareTwoStrings(
      modelQuery.toLowerCase(),
      p.title.toLowerCase()
    );
    return score >= MIN_PRODUCT_SIMILARITY;
  });

  const best = filtered[0] ?? parsed[0];
  const title = (best?.title ?? "").trim();
  const titleMapped = mapCategoryFromTokens([title]);
  let detectedCategory: "casque" | "blouson" | "gants" | "bottes" | "pantalon" | null = null;
  let categorySource: "Breadcrumb" | "Title" | "Unknown" = "Unknown";
  if (breadcrumb.category) {
    detectedCategory = breadcrumb.category;
    categorySource = "Breadcrumb";
  } else if (titleMapped.category) {
    detectedCategory = titleMapped.category;
    categorySource = "Title";
  }

  const isAccessory = breadcrumb.isAccessory || titleMapped.isAccessory;

  let skippedReason: string | null = null;
  if (blocks.length === 0) skippedReason = "no_jsonld";
  else if (parsed.length === 0) skippedReason = "no_product_offer";
  else if (filtered.length === 0) skippedReason = "below_similarity_threshold";
  else if (isAccessory) skippedReason = "accessory";
  else if (!detectedCategory) skippedReason = "unknown_category";

  return {
    url: productUrl,
    retailerSource,
    httpStatus: fetched.status,
    jsonLdBlockCount: blocks.length,
    jsonLdTypes: blocks.flatMap(jsonLdTypesFromBlock),
    breadcrumbLabels: breadcrumb.breadcrumbLabels,
    detectedCategory,
    categorySource,
    isAccessory,
    candidates,
    filteredInCount: filtered.length,
    skippedReason,
  };
}
