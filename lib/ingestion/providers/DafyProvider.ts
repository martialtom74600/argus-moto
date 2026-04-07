import type { Browser, BrowserContext } from "playwright";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BaseCrawler,
  getCrawlerBrowserHeaders,
  CRAWLER_USER_AGENT,
  type CrawlResult,
} from "@/lib/ingestion/core/BaseCrawler";

const DAFY_HOME = "https://www.dafy-moto.com/";

function parseXmlTagValues(xml: string, tagName: string): string[] {
  const out: string[] = [];
  const rx = new RegExp(`<${tagName}>(.*?)</${tagName}>`, "gims");
  for (const m of xml.matchAll(rx)) {
    const v = (m[1] ?? "").trim();
    if (v) out.push(v);
  }
  return out;
}

function dafyPlaywrightDisabled(): boolean {
  const v = process.env.INGEST_DAFY_PLAYWRIGHT?.trim().toLowerCase();
  return v === "0" || v === "false" || v === "off";
}

export class DafyProvider extends BaseCrawler {
  protected retailerName = "Dafy";
  protected retailerReferer = DAFY_HOME;

  private pwBrowser: Browser | null = null;
  private pwContext: BrowserContext | null = null;

  async ingest(
    supabase: SupabaseClient,
    limit: number,
    opts?: { verbose?: boolean }
  ): Promise<{ inserted: number; failed: Array<{ url: string; reason: string }> }> {
    if (dafyPlaywrightDisabled()) {
      console.warn(
        "[Dafy] Playwright désactivé (INGEST_DAFY_PLAYWRIGHT=0) — risque de http_503 massifs avec fetch seul."
      );
      return super.ingest(supabase, limit, opts);
    }

    try {
      const { chromium } = await import("playwright");
      const channel = process.env.PLAYWRIGHT_CHANNEL?.trim();
      this.pwBrowser = await chromium.launch({
        headless: process.env.PLAYWRIGHT_HEADED !== "1",
        channel: channel ? (channel as "chrome" | "msedge") : undefined,
        args: ["--disable-blink-features=AutomationControlled"],
      });
      this.pwContext = await this.pwBrowser.newContext({
        userAgent: CRAWLER_USER_AGENT,
        locale: "fr-FR",
        viewport: { width: 1365, height: 900 },
      });

      const warm = await this.pwContext.newPage();
      try {
        await warm.goto(DAFY_HOME, { waitUntil: "load", timeout: 60_000 });
        await new Promise((r) => setTimeout(r, 1500));
      } catch {
        console.warn("[Dafy] Échauffage accueil incomplet — poursuite quand même.");
      } finally {
        await warm.close();
      }

      const ch = channel ? ` (canal ${channel})` : "";
      console.log(
        `[Dafy] Playwright${ch} : session navigateur + cookies. Si tu as encore des 503, teste depuis chez toi ou définis PLAYWRIGHT_CHANNEL=chrome (Chrome installé).`
      );
      return await super.ingest(supabase, limit, opts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        "[Dafy] Playwright : npm i playwright && npx playwright install chromium —",
        msg
      );
      throw e;
    } finally {
      if (this.pwContext) {
        await this.pwContext.close().catch(() => {});
        this.pwContext = null;
      }
      if (this.pwBrowser) {
        await this.pwBrowser.close().catch(() => {});
        this.pwBrowser = null;
      }
    }
  }

  protected async fetchWithStealth(
    url: string,
    referer = this.retailerReferer,
    opts?: { maxRetries?: number }
  ): Promise<{ ok: boolean; status: number; text: string }> {
    if (!this.pwContext) {
      return super.fetchWithStealth(url, referer, opts);
    }

    const page = await this.pwContext.newPage();
    try {
      await page.setExtraHTTPHeaders(getCrawlerBrowserHeaders(url, referer));
      const resp = await page.goto(url, {
        waitUntil: "load",
        timeout: 65_000,
      });
      const status = resp?.status() ?? 0;
      await new Promise((r) => setTimeout(r, 1800));
      const text = await page.content();
      const ok = status >= 200 && status < 400 && text.length > 0;
      return { ok, status: status > 0 ? status : ok ? 200 : 0, text };
    } catch {
      return { ok: false, status: 0, text: "" };
    } finally {
      await page.close();
    }
  }

  protected async discoverUrls(limit: number): Promise<string[]> {
    const sitemap = "https://www.dafy-moto.com/sitemap-produits.xml";
    const fetched = await this.fetchWithStealth(sitemap);
    if (!fetched.ok) return [];
    if (/en cours de maintenance/i.test(fetched.text)) return [];
    return parseXmlTagValues(fetched.text, "loc").slice(0, limit);
  }

  protected async parseProductPage(url: string): Promise<CrawlResult> {
    const fetched = await this.fetchWithStealth(url);
    if (!fetched.ok) {
      return { ok: false, reason: fetched.status ? `http_${fetched.status}` : "network_error" };
    }
    if (/maintenance/i.test(fetched.text)) return { ok: false, reason: "maintenance" };
    const blocks = this.extractJsonLd(fetched.text);
    if (blocks.length === 0) return { ok: false, reason: "no_jsonld" };
    const scope = this.gateGearCategory(blocks);
    if (!scope.ok) return { ok: false, reason: scope.reason };
    const nodes = blocks.flatMap((b) => this.flattenJsonLdNodes(b));
    const productNode = nodes.find((n) =>
      String(n["@type"] ?? "").toLowerCase().includes("product")
    );
    if (!productNode) return { ok: false, reason: "no_product_node" };

    const name = typeof productNode.name === "string" ? productNode.name.trim() : "";
    if (!name) return { ok: false, reason: "no_product_title" };
    const words = name.split(/\s+/).filter(Boolean);
    let brand = "";
    if (typeof productNode.brand === "string") brand = productNode.brand.trim();
    if (!brand && productNode.brand && typeof productNode.brand === "object") {
      const bn = (productNode.brand as Record<string, unknown>).name;
      if (typeof bn === "string") brand = bn.trim();
    }
    if (!brand) brand = words[0] ?? "unknown";

    const offers = productNode.offers;
    const offer = Array.isArray(offers) ? offers[0] : offers;
    const priceRaw = offer && typeof offer === "object" ? (offer as Record<string, unknown>).price : null;
    const price =
      typeof priceRaw === "number"
        ? priceRaw
        : typeof priceRaw === "string"
          ? Number.parseFloat(priceRaw.replace(",", "."))
          : NaN;

    return {
      ok: true,
      product: {
        brand,
        name,
        model: name,
        category: scope.category,
        isAccessory: false,
        price: Number.isFinite(price) ? price : null,
        availability: null,
        imageUrl:
          typeof productNode.image === "string"
            ? productNode.image
            : Array.isArray(productNode.image) && typeof productNode.image[0] === "string"
              ? productNode.image[0]
              : null,
        eanCode:
          typeof productNode.gtin13 === "string"
            ? productNode.gtin13
            : typeof productNode.gtin === "string"
              ? productNode.gtin
              : typeof productNode.ean === "string"
                ? productNode.ean
                : null,
        url,
      },
    };
  }
}
