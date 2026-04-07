import { BaseCrawler, type CrawlResult } from "@/lib/ingestion/core/BaseCrawler";
import { discoverMotoblouzProductUrls } from "@/lib/ingestion/motoblouz-master";

export class MotoblouzProvider extends BaseCrawler {
  protected retailerName = "Motoblouz";
  protected retailerReferer = "https://www.motoblouz.com/";

  protected async discoverUrls(limit: number): Promise<string[]> {
    return await discoverMotoblouzProductUrls(limit);
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
    let brand = "";
    if (typeof productNode.brand === "string") brand = productNode.brand.trim();
    if (!brand && productNode.brand && typeof productNode.brand === "object") {
      const bn = (productNode.brand as Record<string, unknown>).name;
      if (typeof bn === "string") brand = bn.trim();
    }
    if (!brand) brand = name.split(/\s+/)[0] ?? "unknown";

    const offers = productNode.offers;
    const offer = Array.isArray(offers) ? offers[0] : offers;
    const priceRaw = offer && typeof offer === "object" ? (offer as Record<string, unknown>).price : null;
    const price =
      typeof priceRaw === "number"
        ? priceRaw
        : typeof priceRaw === "string"
          ? Number.parseFloat(priceRaw.replace(",", "."))
          : NaN;

    const eanCode =
      typeof productNode.gtin13 === "string"
        ? productNode.gtin13
        : typeof productNode.gtin === "string"
          ? productNode.gtin
          : typeof productNode.ean === "string"
            ? productNode.ean
            : null;

    return {
      ok: true,
      product: {
        brand,
        name,
        model: name,
        category: scope.category,
        isAccessory: false,
        price: Number.isFinite(price) ? price : null,
        availability:
          offer && typeof offer === "object" && typeof (offer as Record<string, unknown>).availability === "string"
            ? String((offer as Record<string, unknown>).availability)
            : null,
        imageUrl:
          typeof productNode.image === "string"
            ? productNode.image
            : Array.isArray(productNode.image) && typeof productNode.image[0] === "string"
              ? productNode.image[0]
              : null,
        eanCode,
        url,
      },
    };
  }
}
