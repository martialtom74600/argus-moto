/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const RETAILERS = [
  { sourceLabel: "Dafy", sitemapUrls: ["https://www.dafy-moto.com/sitemap.xml"] },
  { sourceLabel: "Motoblouz", sitemapUrls: ["https://www.motoblouz.com/sitemap.xml"] },
  { sourceLabel: "FC-Moto", sitemapUrls: ["https://www.fc-moto.de/sitemap.xml"] },
] as const;

const MAX_DAILY_REFRESH = 100;
const MAX_URLS_PER_SITEMAP = 100;

function isMockModeEnabled(): boolean {
  return (Deno.env.get("NEXT_PUBLIC_USE_MOCK_DATA") ?? "").trim() === "true";
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
  const out: string[] = [];
  const rx =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gim;
  for (const m of html.matchAll(rx)) {
    const raw = (m[1] ?? "").trim();
    if (raw) out.push(raw);
  }
  return out;
}

function parseJsonLdPrice(block: string): number[] {
  try {
    const node = JSON.parse(block) as unknown;
    const list = Array.isArray(node) ? node : [node];
    const prices: number[] = [];
    for (const n of list) {
      if (!n || typeof n !== "object") continue;
      const product = n as Record<string, unknown>;
      const offers = product.offers;
      const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];
      for (const offer of offerList) {
        if (!offer || typeof offer !== "object") continue;
        const raw = (offer as Record<string, unknown>).price;
        const value =
          typeof raw === "number"
            ? raw
            : typeof raw === "string"
              ? Number.parseFloat(raw.replace(",", "."))
              : NaN;
        if (Number.isFinite(value) && value > 0) prices.push(value);
      }
    }
    return prices;
  } catch {
    return [];
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "le-coin-moto-refresh-job/1.0" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const v =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  return Math.round(v * 100) / 100;
}

async function crawlPrice(brand: string, model: string): Promise<{ price: number; source: string } | null> {
  if (isMockModeEnabled()) {
    return { price: 299, source: "Mock Data Lake" };
  }

  const needles = `${brand} ${model}`
    .toLowerCase()
    .split(" ")
    .filter((x) => x.length >= 2);

  const pricesByRetailer: { source: string; prices: number[] }[] = [];
  for (const retailer of RETAILERS) {
    const gathered: number[] = [];
    for (const sitemapUrl of retailer.sitemapUrls) {
      const xml = await fetchText(sitemapUrl);
      if (!xml) continue;
      const urls = extractXmlTagValues(xml, "loc").slice(0, MAX_URLS_PER_SITEMAP);
      for (const url of urls) {
        const low = url.toLowerCase();
        if (!needles.some((n) => low.includes(n))) continue;
        const html = await fetchText(url);
        if (!html) continue;
        for (const block of extractJsonLdBlocks(html)) {
          gathered.push(...parseJsonLdPrice(block));
        }
      }
    }
    pricesByRetailer.push({ source: retailer.sourceLabel, prices: gathered });
  }

  const all = pricesByRetailer.flatMap((x) => x.prices);
  const med = median(all);
  if (med == null) return null;

  pricesByRetailer.sort((a, b) => b.prices.length - a.prices.length);
  return { price: med, source: pricesByRetailer[0]?.source ?? "Internal crawler" };
}

Deno.serve(async () => {
  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response("Missing Supabase env vars", { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: rows, error } = await supabase
    .from("products")
    .select("id, brand, model")
    .eq("is_accessory", false)
    .order("updated_at", { ascending: true, nullsFirst: true })
    .limit(MAX_DAILY_REFRESH);

  if (error) {
    return new Response(error.message, { status: 500 });
  }

  let refreshed = 0;
  for (const row of rows ?? []) {
    const crawled = await crawlPrice(row.brand, row.model);
    if (!crawled) continue;

    const nowIso = new Date().toISOString();
    await supabase
      .from("products")
      .update({
        aggregated_retail_eur: crawled.price,
        last_retailer_source: crawled.source,
        last_official_feed: true,
        updated_at: nowIso,
      })
      .eq("id", row.id);

    await supabase.from("product_price_history").insert({
      product_id: row.id,
      price: crawled.price,
      observed_at: nowIso,
    });

    refreshed += 1;
  }

  return Response.json({ ok: true, refreshed, requested: MAX_DAILY_REFRESH });
});
