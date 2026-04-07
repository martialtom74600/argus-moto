import type { SupabaseClient } from "@supabase/supabase-js";
import { mapCategoryAndAccessory } from "@/lib/ingestion/category-mapper";

const BASE_SITEMAP_URL = "https://media.motoblouz.com/sitemap/motoblouz/";
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const RETAILER_NAME = "Motoblouz";

export type CrawlFailureReason =
  | "http_403"
  | "http_404"
  | "maintenance"
  | "no_jsonld"
  | "no_ean"
  | "unknown_category"
  | "accessory"
  | "network_error";

export type MotoblouzProductRecord = {
  eanCode: string;
  brand: string;
  model: string;
  category: "casque" | "blouson" | "gants" | "bottes" | "pantalon";
  imageUrl: string | null;
  isAccessory: boolean;
  price: number;
  availability: string | null;
  url: string;
};

function parseXmlTagValues(xml: string, tagName: string): string[] {
  const out: string[] = [];
  const rx = new RegExp(`<${tagName}>(.*?)</${tagName}>`, "gims");
  for (const m of xml.matchAll(rx)) {
    const v = (m[1] ?? "").trim();
    if (v) out.push(v);
  }
  return out;
}

async function fetchText(url: string, referer: string): Promise<{
  ok: boolean;
  status: number;
  text: string;
}> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": CHROME_UA,
        referer,
      },
      cache: "no-store",
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch {
    return { ok: false, status: 0, text: "" };
  }
}

function extractJsonLdBlocks(html: string): string[] {
  const out: string[] = [];
  const rx =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gim;
  for (const m of html.matchAll(rx)) {
    const s = (m[1] ?? "").trim();
    if (s) out.push(s);
  }
  return out;
}

function flattenNodes(block: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  try {
    const parsed = JSON.parse(block) as unknown;
    const roots = Array.isArray(parsed) ? parsed : [parsed];
    for (const root of roots) {
      if (!root || typeof root !== "object") continue;
      const obj = root as Record<string, unknown>;
      out.push(obj);
      const graph = obj["@graph"];
      if (Array.isArray(graph)) {
        for (const g of graph) {
          if (g && typeof g === "object") out.push(g as Record<string, unknown>);
        }
      }
    }
  } catch {
    return [];
  }
  return out;
}

function deepCollectByKey(input: unknown, keyRx: RegExp, acc: string[]): void {
  if (input == null) return;
  if (Array.isArray(input)) {
    for (const it of input) deepCollectByKey(it, keyRx, acc);
    return;
  }
  if (typeof input !== "object") return;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (keyRx.test(k) && typeof v === "string" && v.trim()) acc.push(v.trim());
    deepCollectByKey(v, keyRx, acc);
  }
}

function normalizePotentialEan(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 14) return digits;
  return null;
}

function parseBreadcrumbCategory(blocks: string[]): {
  category: "casque" | "blouson" | "gants" | "bottes" | "pantalon" | null;
  isAccessory: boolean;
} {
  const labels: string[] = [];
  for (const block of blocks) {
    for (const node of flattenNodes(block)) {
      const t = String(node["@type"] ?? "").toLowerCase();
      if (!t.includes("breadcrumblist")) continue;
      const items = Array.isArray(node.itemListElement) ? node.itemListElement : [];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const n = (item as Record<string, unknown>).name;
        if (typeof n === "string" && n.trim()) labels.push(n.trim());
      }
    }
  }

  const joined = labels.join(" ").toLowerCase();
  return mapCategoryAndAccessory([joined]);
}

function parseProductNode(blocks: string[]): {
  eanCode: string | null;
  brand: string;
  model: string;
  imageUrl: string | null;
  price: number | null;
  availability: string | null;
} | null {
  for (const block of blocks) {
    for (const node of flattenNodes(block)) {
      const type = String(node["@type"] ?? "").toLowerCase();
      if (!type.includes("product")) continue;
      const name = typeof node.name === "string" ? node.name.trim() : "";
      const words = name.split(/\s+/).filter(Boolean);
      let brand = "";
      if (typeof node.brand === "string") brand = node.brand.trim();
      if (!brand && node.brand && typeof node.brand === "object") {
        const bn = (node.brand as Record<string, unknown>).name;
        if (typeof bn === "string") brand = bn.trim();
      }
      if (!brand) brand = words[0] ?? "unknown";
      const model = name || "unknown-model";
      const eanCandidates: string[] = [];
      deepCollectByKey(node, /^(gtin13|gtin12|gtin14|gtin|ean)$/i, eanCandidates);
      const directSku = typeof node.sku === "string" ? node.sku : "";
      const directMpn = typeof node.mpn === "string" ? node.mpn : "";
      if (directSku) eanCandidates.push(directSku);
      if (directMpn) eanCandidates.push(directMpn);
      const eanCode =
        eanCandidates.map(normalizePotentialEan).find((x): x is string => x != null) ??
        null;
      const imageUrl =
        typeof node.image === "string"
          ? node.image
          : Array.isArray(node.image) && typeof node.image[0] === "string"
            ? node.image[0]
            : null;
      const offers = node.offers;
      const offer = Array.isArray(offers) ? offers[0] : offers;
      let price: number | null = null;
      let availability: string | null = null;
      if (offer && typeof offer === "object") {
        const priceRaw = (offer as Record<string, unknown>).price;
        const num =
          typeof priceRaw === "number"
            ? priceRaw
            : typeof priceRaw === "string"
              ? Number.parseFloat(priceRaw.replace(",", "."))
              : NaN;
        if (Number.isFinite(num) && num > 0) price = num;
        const availRaw = (offer as Record<string, unknown>).availability;
        if (typeof availRaw === "string") availability = availRaw;
      }
      return { eanCode, brand, model, imageUrl, price, availability };
    }
  }
  return null;
}

export async function discoverMotoblouzProductUrls(maxUrls: number): Promise<string[]> {
  const urls: string[] = [];
  for (let i = 1; i <= 19 && urls.length < maxUrls; i++) {
    const sitemapUrl = `${BASE_SITEMAP_URL}sitemap-product-${i}.xml`;
    const fetched = await fetchText(sitemapUrl, "https://www.motoblouz.com/");
    if (!fetched.ok) continue;
    const locs = parseXmlTagValues(fetched.text, "loc");
    for (const u of locs) {
      if (urls.length >= maxUrls) break;
      urls.push(u);
    }
  }
  return urls;
}

export async function crawlMotoblouzProductPage(url: string): Promise<
  { ok: true; record: MotoblouzProductRecord } | { ok: false; reason: CrawlFailureReason }
> {
  const fetched = await fetchText(url, "https://www.motoblouz.com/");
  if (!fetched.ok) {
    if (fetched.status === 403) return { ok: false, reason: "http_403" };
    if (fetched.status === 404) return { ok: false, reason: "http_404" };
    return { ok: false, reason: "network_error" };
  }
  if (/maintenance/i.test(fetched.text)) return { ok: false, reason: "maintenance" };

  const blocks = extractJsonLdBlocks(fetched.text);
  if (blocks.length === 0) return { ok: false, reason: "no_jsonld" };

  const product = parseProductNode(blocks);
  if (!product) return { ok: false, reason: "no_jsonld" };
  if (!product.eanCode) return { ok: false, reason: "no_ean" };

  const breadcrumb = parseBreadcrumbCategory(blocks);
  if (breadcrumb.isAccessory) return { ok: false, reason: "accessory" };
  if (!breadcrumb.category) return { ok: false, reason: "unknown_category" };
  if (!product.price || product.price <= 0) return { ok: false, reason: "no_jsonld" };

  return {
    ok: true,
    record: {
      eanCode: product.eanCode,
      brand: product.brand.trim(),
      model: product.model.trim(),
      category: breadcrumb.category,
      imageUrl: product.imageUrl,
      isAccessory: breadcrumb.isAccessory,
      price: product.price,
      availability: product.availability,
      url,
    },
  };
}

export async function ingestMotoblouzRecord(
  supabase: SupabaseClient,
  record: MotoblouzProductRecord
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { data: productRow, error: productErr } = await supabase
    .from("products")
    .upsert(
      {
        ean_code: record.eanCode,
        brand: record.brand,
        model: record.model,
        category: record.category,
        image_url: record.imageUrl,
        is_accessory: record.isAccessory,
        updated_at: nowIso,
      },
      { onConflict: "ean_code" }
    )
    .select("id")
    .single();
  if (productErr || !productRow?.id) {
    throw new Error(productErr?.message ?? "product_upsert_failed");
  }

  const { error: retailerErr } = await supabase.from("retailer_prices").upsert(
    {
      product_id: productRow.id,
      retailer_name: RETAILER_NAME,
      price: record.price,
      availability: record.availability,
      url: record.url,
      observed_at: nowIso,
    },
    { onConflict: "product_id,retailer_name,url" }
  );
  if (retailerErr) throw new Error(retailerErr.message);
}

export async function applyHumanDelay(): Promise<void> {
  const ms = Math.floor(Math.random() * 2000) + 1500;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function coffeeBreak(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 15_000));
}
