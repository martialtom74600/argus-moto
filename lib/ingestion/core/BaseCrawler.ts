import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import stringSimilarity from "string-similarity";
import { generateCanonicalSlug } from "@/lib/pricing/matcher";
import { mapCategoryAndAccessory, type GearCategory } from "@/lib/ingestion/category-mapper";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function hostnameKey(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function secFetchSite(targetUrl: string, referer: string): "same-origin" | "cross-site" {
  const t = hostnameKey(targetUrl);
  const r = hostnameKey(referer);
  if (t && r && t === r) return "same-origin";
  return "cross-site";
}

/** Même empreinte pour `fetch` ou Playwright (`setExtraHTTPHeaders`). */
export function getCrawlerBrowserHeaders(
  targetUrl: string,
  referer: string
): Record<string, string> {
  return browserLikeHeaders(targetUrl, referer);
}

export const CRAWLER_USER_AGENT = CHROME_UA;

function browserLikeHeaders(targetUrl: string, referer: string): Record<string, string> {
  return {
    "user-agent": CRAWLER_USER_AGENT,
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    "accept-encoding": "gzip, deflate",
    "cache-control": "max-age=0",
    dnt: "1",
    referer,
    "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": secFetchSite(targetUrl, referer),
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
  };
}

export type CrawlProduct = {
  brand: string;
  name: string;
  model: string;
  category: GearCategory | null;
  isAccessory: boolean;
  price: number | null;
  availability: string | null;
  imageUrl: string | null;
  eanCode: string | null;
  url: string;
};

export type CrawlResult =
  | { ok: true; product: CrawlProduct }
  | { ok: false; reason: string };

export abstract class BaseCrawler {
  protected abstract retailerName: string;
  protected abstract retailerReferer: string;

  protected async randomHumanDelay(minMs = 1500, maxMs = 3500): Promise<void> {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected async coffeeBreak(ms = 15000): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Requête « navigateur » + backoff sur 503/429 (souvent anti-bot / charge serveur).
   */
  protected async fetchWithStealth(
    url: string,
    referer = this.retailerReferer,
    opts?: { maxRetries?: number }
  ): Promise<{ ok: boolean; status: number; text: string }> {
    const maxRetries = opts?.maxRetries ?? 3;
    let last: { ok: boolean; status: number; text: string } = {
      ok: false,
      status: 0,
      text: "",
    };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const backoffMs = 5000 + Math.floor(Math.random() * 10000);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
      try {
        const res = await fetch(url, {
          headers: browserLikeHeaders(url, referer),
          cache: "no-store",
        });
        const text = await res.text();
        last = { ok: res.ok, status: res.status, text };

        if (res.ok) return last;
        if (res.status !== 503 && res.status !== 429) return last;
      } catch {
        last = { ok: false, status: 0, text: "" };
      }
    }

    return last;
  }

  protected extractJsonLd(html: string): string[] {
    const blocks: string[] = [];
    const rx =
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gim;
    for (const m of html.matchAll(rx)) {
      const raw = (m[1] ?? "").trim();
      if (raw) blocks.push(raw);
    }
    return blocks;
  }

  protected flattenJsonLdNodes(block: string): Record<string, unknown>[] {
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

  protected parseBreadcrumbCategory(blocks: string[]): {
    category: GearCategory | null;
    isAccessory: boolean;
    labels: string[];
  } {
    const labels: string[] = [];
    for (const block of blocks) {
      for (const node of this.flattenJsonLdNodes(block)) {
        const t = String(node["@type"] ?? "").toLowerCase();
        if (!t.includes("breadcrumblist")) continue;
        const items = Array.isArray(node.itemListElement) ? node.itemListElement : [];
        for (const it of items) {
          if (!it || typeof it !== "object") continue;
          const name = (it as Record<string, unknown>).name;
          if (typeof name === "string" && name.trim()) labels.push(name.trim());
        }
      }
    }
    const mapped = mapCategoryAndAccessory(labels);
    return { ...mapped, labels };
  }

  /** Uniquement casque / blouson / gants / bottes — rien d'autre n'est ingéré. */
  protected gateGearCategory(blocks: string[]):
    | { ok: true; category: GearCategory }
    | { ok: false; reason: string } {
    const b = this.parseBreadcrumbCategory(blocks);
    if (b.isAccessory) return { ok: false, reason: "accessory" };
    if (!b.category) return { ok: false, reason: "out_of_scope_category" };
    return { ok: true, category: b.category };
  }

  protected async processProduct(
    supabase: SupabaseClient,
    product: CrawlProduct,
    toMerge: Array<Record<string, unknown>>
  ): Promise<{ ok: boolean; canonicalSlug?: string; reason?: string }> {
    if (!product.category) return { ok: false, reason: "out_of_scope_category" };
    if (product.isAccessory) return { ok: false, reason: "accessory" };
    if (!product.price || product.price <= 0) return { ok: false, reason: "no_price" };

    const canonicalSlug = generateCanonicalSlug(product.brand, product.name);
    const nowIso = new Date().toISOString();
    const { data: existing, error: findErr } = await supabase
      .from("products")
      .select("id")
      .eq("canonical_slug", canonicalSlug)
      .limit(1)
      .maybeSingle();
    if (findErr) return { ok: false, reason: `lookup_error:${findErr.message}` };

    let productId = existing?.id as string | undefined;
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
        toMerge.push({
          existingSlug: close,
          candidateSlug: canonicalSlug,
          similarity: stringSimilarity.compareTwoStrings(close, canonicalSlug),
          retailer: this.retailerName,
          url: product.url,
        });
      }
    }

    if (!productId) {
      const { data: created, error: createErr } = await supabase
        .from("products")
        .insert({
          ean_code: product.eanCode,
          canonical_slug: canonicalSlug,
          brand: product.brand,
          model: product.model,
          category: product.category,
          image_url: product.imageUrl,
          is_accessory: product.isAccessory,
          updated_at: nowIso,
        })
        .select("id")
        .single();
      if (createErr || !created?.id) {
        return {
          ok: false,
          reason: `create_product_error:${createErr?.message ?? "unknown"}`,
        };
      }
      productId = created.id;
    }

    const { error: priceErr } = await supabase.from("retailer_prices").upsert(
      {
        product_id: productId,
        retailer_name: this.retailerName,
        price: product.price,
        availability: product.availability,
        url: product.url,
        observed_at: nowIso,
      },
      { onConflict: "product_id,retailer_name,url" }
    );
    if (priceErr) return { ok: false, reason: `retailer_price_error:${priceErr.message}` };

    return { ok: true, canonicalSlug };
  }

  protected abstract discoverUrls(limit: number): Promise<string[]>;
  protected abstract parseProductPage(url: string): Promise<CrawlResult>;

  async ingest(
    supabase: SupabaseClient,
    limit: number,
    opts?: { verbose?: boolean }
  ): Promise<{ inserted: number; failed: Array<{ url: string; reason: string }> }> {
    const verbose = opts?.verbose === true;
    const urls = await this.discoverUrls(limit);
    const failed: Array<{ url: string; reason: string }> = [];
    const toMerge: Array<Record<string, unknown>> = [];
    let inserted = 0;
    const total = urls.length;
    if (total === 0) {
      console.log("[ingest] Aucune URL découverte (sitemap vide ou filtrage).");
    } else {
      console.log(`[ingest] ${total} URL(s) à traiter pour ${this.retailerName}.`);
    }

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      await this.randomHumanDelay();
      const parsed = await this.parseProductPage(url);
      if (!parsed.ok) {
        failed.push({ url, reason: parsed.reason });
        if (verbose) console.log(`[skip] ${parsed.reason}\t${url}`);
      } else {
        const p = parsed.product;
        const result = await this.processProduct(supabase, p, toMerge);
        if (!result.ok) {
          failed.push({ url, reason: result.reason ?? "unknown_error" });
          if (verbose) console.log(`[skip] ${result.reason}\t${url}`);
        } else {
          inserted += 1;
          console.log(
            `[MATCHING] Nom site: ${p.name} ---> Slug Universel: ${result.canonicalSlug ?? ""}`
          );
          if ((i + 1) % 20 === 0 && i + 1 < urls.length) await this.coffeeBreak();
        }
      }
      if (!verbose && (i + 1) % 10 === 0) {
        console.log(
          `[progress] ${i + 1}/${total} insérés=${inserted} échecs=${failed.length} (chaque ligne: --verbose)`
        );
      }
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

    return { inserted, failed };
  }
}
