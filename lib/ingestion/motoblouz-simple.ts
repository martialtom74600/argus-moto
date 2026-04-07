import type { SupabaseClient } from "@supabase/supabase-js";

export type MotoblouzCategory =
  | "casque"
  | "blouson"
  | "gants"
  | "bottes"
  | "pantalon";

export type MotoblouzExtracted = {
  brand: string;
  name: string;
  price: number;
  image: string;
  identifier: string | null;
  category: MotoblouzCategory;
  canonical_slug: string;
  /** Modèle court (affichage / DB) */
  model: string;
};

const LD_JSON_REGEX =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** En-têtes validés pour les pages produit (référent moteur de recherche). */
export const MOTOBLOUZ_STEALTH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.google.com/",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
} as const;

/**
 * Index sitemap Motoblouz (fr_FR) : référence dynamique vers tous les
 * `sitemap-product-*.xml` + brand, category, moto…
 * @see https://media.motoblouz.com/sitemap/fr_FR/motoblouz/sitemap-index.xml
 */
export const MOTOBLOUZ_DEFAULT_SITEMAP_INDEX =
  "https://media.motoblouz.com/sitemap/fr_FR/motoblouz/sitemap-index.xml";

const SITEMAP_LOC_REGEX = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
const PRODUCT_SITEMAP_PATH = /\/sitemap-product-\d+\.xml/i;

/** Seuil au-dessus duquel `take` signifie « tout le flux » (évite skip + MAX_SAFE_INTEGER). */
const SITEMAP_UNBOUNDED_TAKE = 1_000_000_000;

function slugifySegment(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Format comparateur : [marque]-[modèle-nettoyé], minuscules, sans accents ni espaces. */
export function buildCanonicalSlug(brand: string, productName: string): string {
  const brandPart = slugifySegment(brand);
  const beforeVariant = productName.split("+")[0]?.trim() ?? productName.trim();
  const modelPart = slugifySegment(beforeVariant);
  return [brandPart, modelPart].filter(Boolean).join("-");
}

function readBrand(raw: unknown): string {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (raw && typeof raw === "object" && "name" in raw) {
    const n = (raw as { name?: unknown }).name;
    if (typeof n === "string" && n.trim()) return n.trim();
  }
  return "";
}

function readSinglePriceValue(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const n = Number.parseFloat(raw.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function readPrice(offers: unknown): number | null {
  if (offers == null) return null;
  if (Array.isArray(offers)) {
    for (const item of offers) {
      const v = readPrice(item);
      if (v != null) return v;
    }
    return null;
  }
  if (typeof offers !== "object") return null;
  const o = offers as Record<string, unknown>;

  const direct = readSinglePriceValue(o.price);
  if (direct != null) return direct;

  const agg = o.aggregateOffer;
  if (agg && typeof agg === "object") {
    const a = agg as Record<string, unknown>;
    for (const key of ["lowPrice", "highPrice", "price"] as const) {
      const v = readSinglePriceValue(a[key]);
      if (v != null) return v;
    }
  }

  if (Array.isArray(o.offers)) {
    for (const item of o.offers) {
      const v = readPrice(item);
      if (v != null) return v;
    }
  }
  return null;
}

function normalizeImageUrl(src: string): string {
  const t = src.trim();
  if (t.startsWith("//")) return `https:${t}`;
  return t;
}

function listJsonLdRoots(text: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && "@graph" in parsed) {
      const g = (parsed as { "@graph"?: unknown })["@graph"];
      if (Array.isArray(g)) return g;
    }
    return [parsed];
  } catch {
    return [];
  }
}

function collectByType(nodes: unknown[], target: string): unknown[] {
  const out: unknown[] = [];
  const visit = (n: unknown) => {
    if (n == null) return;
    if (Array.isArray(n)) {
      for (const x of n) visit(x);
      return;
    }
    if (typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    const t = o["@type"];
    if (t === target) out.push(n);
    else if (Array.isArray(t) && t.includes(target)) out.push(n);
    for (const v of Object.values(o)) visit(v as unknown);
  };
  for (const root of nodes) visit(root);
  return out;
}

export type MotoblouzParseFailureReason =
  | "no_product"
  | "invalid_data"
  | "no_price"
  | "accessory"
  | "unknown_category";

export type MotoblouzParseResult =
  | { ok: true; data: MotoblouzExtracted }
  | { ok: false; reason: MotoblouzParseFailureReason };

function listItemPosition(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Tous les libellés du fil d’Ariane (triés par position), pas seulement 2–3 : Motoblouz met souvent « Équipement » en 2. */
function breadcrumbLabelsAll(nodes: unknown[]): string[] {
  const labels: string[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const items = (node as { itemListElement?: unknown }).itemListElement;
    if (!Array.isArray(items)) continue;

    const byPosition = new Map<number, string>();
    for (const el of items) {
      if (!el || typeof el !== "object") continue;
      const pos = listItemPosition((el as { position?: unknown }).position);
      const nm = (el as { name?: unknown }).name;
      if (pos == null || typeof nm !== "string" || !nm.trim()) continue;
      byPosition.set(pos, nm.trim());
    }

    const sorted = [...byPosition.entries()].sort((a, b) => a[0] - b[0]);
    for (const [, nm] of sorted) labels.push(nm);
  }
  return labels;
}

function normalizePathHints(p: string): string {
  return p
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Repli quand le fil d’Ariane est générique (« Équipement Moto Homme », « Froid et Pluie »).
 * L’URL Motoblouz encode le type : vente-veste-*, vente-sur-gants-*, etc.
 */
export function classifyCategoryFromMotoblouzPath(pathname: string): MotoblouzCategory | "accessory" | null {
  const p = normalizePathHints(pathname);

  if (
    p.includes("ecran-casque") ||
    p.includes("top-case") ||
    p.includes("valise-") ||
    p.includes("filet-") ||
    p.includes("vente-bulle") ||
    p.includes("-bulle-") ||
    p.includes("sabot-moteur") ||
    p.includes("vente-sabot") ||
    p.includes("plaquette") ||
    p.includes("protege-chaussures") ||
    p.includes("protection-echappement") ||
    p.includes("masque-antipollution") ||
    p.includes("tour-de-cou") ||
    p.includes("intercom") ||
    p.includes("sacoche") ||
    p.includes("cagoule") ||
    p.includes("antivol") ||
    p.includes("bagagerie") ||
    p.includes("support-gps") ||
    p.includes("-gps-")
  ) {
    return "accessory";
  }

  if (p.includes("sur-gants") || p.includes("-gants-") || p.includes("gants-")) {
    return "gants";
  }
  if (p.includes("sur-bottes") || p.includes("-bottes-") || p.includes("bottes-")) {
    return "bottes";
  }

  if (p.includes("pantalon")) return "pantalon";

  if (
    p.includes("veste") ||
    p.includes("blouson") ||
    (p.includes("combinaison") && p.includes("pluie")) ||
    p.includes("textile") ||
    p.includes("jean-moto")
  ) {
    return "blouson";
  }

  if (p.includes("casque")) return "casque";

  return null;
}

/**
 * Priorité : accessoires (fil d’ariane « Accessoires… ») avant « Casque » pour éviter
 * de classer une page d’accessoires casque comme un casque.
 */
function classifyBreadcrumbLabels(labels: string[]): MotoblouzCategory | null | "accessory" {
  for (const label of labels) {
    const n = label.toLowerCase();
    if (n.includes("accessoire")) return "accessory";
  }
  for (const label of labels) {
    const n = label.toLowerCase();
    if (n.includes("gant")) return "gants";
    if (n.includes("bott") || n.includes("botte")) return "bottes";
    if (n.includes("casque")) return "casque";
    if (n.includes("pantalon")) return "pantalon";
    if (n.includes("blouson") || n.includes("veste")) return "blouson";
  }
  return null;
}

function mergeCategoryDecision(
  fromBreadcrumb: MotoblouzCategory | null | "accessory",
  fromPath: MotoblouzCategory | null | "accessory"
): MotoblouzCategory | "accessory" | null {
  if (fromPath === "accessory") return "accessory";
  if (fromBreadcrumb === "accessory") return "accessory";
  if (fromBreadcrumb != null) return fromBreadcrumb;
  return fromPath;
}

function readProductImage(obj: Record<string, unknown>): string {
  const imgRaw = obj.image;
  if (typeof imgRaw === "string") return normalizeImageUrl(imgRaw);
  if (Array.isArray(imgRaw)) {
    const first = imgRaw[0];
    if (typeof first === "string") return normalizeImageUrl(first);
    if (first && typeof first === "object" && "url" in first) {
      const u = (first as { url?: unknown }).url;
      if (typeof u === "string") return normalizeImageUrl(u);
    }
  }
  if (imgRaw && typeof imgRaw === "object" && "url" in imgRaw) {
    const u = (imgRaw as { url?: unknown }).url;
    if (typeof u === "string") return normalizeImageUrl(u);
  }
  return "";
}

export function parseMotoblouzHtmlResult(html: string, pageUrl?: string): MotoblouzParseResult {
  const productNodes: unknown[] = [];
  const breadcrumbNodes: unknown[] = [];

  LD_JSON_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LD_JSON_REGEX.exec(html)) !== null) {
    const roots = listJsonLdRoots(m[1] ?? "");
    productNodes.push(...collectByType(roots, "Product"));
    breadcrumbNodes.push(...collectByType(roots, "BreadcrumbList"));
  }

  const product = productNodes[0] as Record<string, unknown> | undefined;
  if (!product) return { ok: false, reason: "no_product" };

  const brand = readBrand(product.brand);
  const name = typeof product.name === "string" ? product.name.trim() : "";
  if (!brand || !name) return { ok: false, reason: "invalid_data" };

  const price = readPrice(product.offers);
  if (price == null || price <= 0) {
    return { ok: false, reason: "no_price" };
  }

  const image = readProductImage(product);
  if (!image) return { ok: false, reason: "invalid_data" };

  const mpn =
    typeof product.mpn === "string" && product.mpn.trim()
      ? product.mpn.trim()
      : null;

  const labels = breadcrumbLabelsAll(breadcrumbNodes);
  const fromBc = classifyBreadcrumbLabels(labels);

  let fromPath: MotoblouzCategory | "accessory" | null = null;
  try {
    if (pageUrl?.trim()) {
      fromPath = classifyCategoryFromMotoblouzPath(new URL(pageUrl).pathname);
    }
  } catch {
    fromPath = null;
  }

  const decided = mergeCategoryDecision(fromBc, fromPath);
  if (decided === "accessory") return { ok: false, reason: "accessory" };
  if (decided == null) return { ok: false, reason: "unknown_category" };

  const category = decided;
  const canonical_slug = buildCanonicalSlug(brand, name);
  const model =
    name
      .split("+")[0]
      ?.replace(/\s+/g, " ")
      .trim() ?? name;

  return {
    ok: true,
    data: {
      brand,
      name,
      price,
      image,
      identifier: mpn,
      category,
      canonical_slug,
      model,
    },
  };
}

export function parseMotoblouzHtml(
  html: string,
  pageUrl?: string
): MotoblouzExtracted | null {
  const r = parseMotoblouzHtmlResult(html, pageUrl);
  return r.ok ? r.data : null;
}

export async function fetchMotoblouzProductPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { ...MOTOBLOUZ_STEALTH_HEADERS },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Motoblouz HTTP ${res.status} pour ${url}`);
  }
  return await res.text();
}

async function fetchMotoblouzSitemapXml(sitemapUrl: string): Promise<string> {
  const res = await fetch(sitemapUrl, {
    headers: { ...MOTOBLOUZ_STEALTH_HEADERS },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Sitemap HTTP ${res.status} pour ${sitemapUrl}`);
  }
  return await res.text();
}

function parseSitemapLocTags(xml: string): string[] {
  const urls: string[] = [];
  SITEMAP_LOC_REGEX.lastIndex = 0;
  for (const m of xml.matchAll(SITEMAP_LOC_REGEX)) {
    const u = (m[1] ?? "").trim();
    if (u) urls.push(u);
  }
  return urls;
}

/** Toutes les balises `<loc>` d’un index ou d’un sitemap Motoblouz. */
export async function fetchMotoblouzChildSitemapUrlsFromIndex(
  indexUrl: string
): Promise<string[]> {
  const xml = await fetchMotoblouzSitemapXml(indexUrl);
  return parseSitemapLocTags(xml);
}

/** Ne garde que les sous-sitemaps produits (`…/sitemap-product-12.xml`, etc.). */
export function filterMotoblouzProductSitemapUrls(urls: string[]): string[] {
  return urls.filter((u) => PRODUCT_SITEMAP_PATH.test(u));
}

export function sortMotoblouzProductSitemapsByNumber(urls: string[]): string[] {
  return [...urls].sort((a, b) => {
    const ma = a.match(/sitemap-product-(\d+)\.xml/i);
    const mb = b.match(/sitemap-product-(\d+)\.xml/i);
    const na = ma ? Number.parseInt(ma[1], 10) : 0;
    const nb = mb ? Number.parseInt(mb[1], 10) : 0;
    return na - nb;
  });
}

/** Ordre stable : product-1, product-2, … (nombre de fichiers variable côté Motoblouz). */
export async function resolveMotoblouzProductSitemapUrls(
  indexUrl: string
): Promise<string[]> {
  const children = await fetchMotoblouzChildSitemapUrlsFromIndex(indexUrl);
  return sortMotoblouzProductSitemapsByNumber(
    filterMotoblouzProductSitemapUrls(children)
  );
}

/** Toutes les URLs produit dans l’ordre (fichiers product triés, puis `<loc>` de chaque fichier). */
export async function* iterateMotoblouzProductPageUrlsFromSitemaps(
  productSitemapUrls: string[]
): AsyncGenerator<string> {
  const sorted = sortMotoblouzProductSitemapsByNumber(productSitemapUrls);
  for (const sm of sorted) {
    let xml: string;
    try {
      xml = await fetchMotoblouzSitemapXml(sm);
    } catch {
      continue;
    }
    SITEMAP_LOC_REGEX.lastIndex = 0;
    for (const m of xml.matchAll(SITEMAP_LOC_REGEX)) {
      const u = (m[1] ?? "").trim();
      if (u) yield u;
    }
  }
}

/**
 * URLs `<loc>` pages produit depuis l’index : fusionne dynamiquement tous les
 * `sitemap-product-*.xml` référencés (skip + take sur le flux global).
 */
export async function fetchMotoblouzProductUrlsFromSitemapIndex(
  indexUrl: string,
  take: number,
  skip = 0
): Promise<string[]> {
  const files = await resolveMotoblouzProductSitemapUrls(indexUrl);
  if (files.length === 0) {
    throw new Error(`Aucun sitemap-product-*.xml dans l’index : ${indexUrl}`);
  }
  const s = Math.max(0, Math.floor(skip));
  const tke = Math.max(0, Math.floor(take));

  if (tke >= SITEMAP_UNBOUNDED_TAKE) {
    const out: string[] = [];
    let idx = 0;
    for await (const u of iterateMotoblouzProductPageUrlsFromSitemaps(files)) {
      idx++;
      if (idx <= s) continue;
      out.push(u);
    }
    return out;
  }

  const need = s + tke;
  const buf: string[] = [];
  outer: for await (const u of iterateMotoblouzProductPageUrlsFromSitemaps(files)) {
    buf.push(u);
    if (buf.length >= need) break outer;
  }
  return buf.slice(s, s + tke);
}

/**
 * URLs `<loc>` d’un seul fichier sitemap produit.
 * @param take nombre d’URLs à retourner après `skip`
 * @param skip ignorer les N premières entrées
 */
export async function fetchMotoblouzProductUrlsFromSitemap(
  sitemapUrl: string,
  take: number,
  skip = 0
): Promise<string[]> {
  const s = Math.max(0, Math.floor(skip));
  const tke = Math.max(0, Math.floor(take));
  const xml = await fetchMotoblouzSitemapXml(sitemapUrl);
  const urls: string[] = [];
  SITEMAP_LOC_REGEX.lastIndex = 0;
  if (tke >= SITEMAP_UNBOUNDED_TAKE) {
    for (const m of xml.matchAll(SITEMAP_LOC_REGEX)) {
      const u = (m[1] ?? "").trim();
      if (u) urls.push(u);
    }
    return urls.slice(s);
  }
  const need = s + tke;
  for (const m of xml.matchAll(SITEMAP_LOC_REGEX)) {
    const u = (m[1] ?? "").trim();
    if (u) urls.push(u);
    if (urls.length >= need) break;
  }
  return urls.slice(s, s + tke);
}

/**
 * Slug d’URL suffisant pour viser de l’équipement pilote (pas une pièce / accessoire
 * identifié par `classifyCategoryFromMotoblouzPath`).
 */
export function urlPathSuggestsWearCategory(url: string): boolean {
  try {
    const hint = classifyCategoryFromMotoblouzPath(new URL(url).pathname);
    return hint !== null && hint !== "accessory";
  } catch {
    return false;
  }
}

/**
 * Parcourt le sitemap dans l’ordre, ignore les `skipEntries` premières entrées, puis collecte
 * jusqu’à `take` URLs qui passe le prédicat (par défaut slugs équipement pilote).
 * Le fichier `sitemap-product-1.xml` est majoritairement pièces détachées : sans ce mode,
 * une tranche `--skip=100 --limit=400` tombe sur des bulles / sabots → 0 fiche utile.
 */
export async function collectMotoblouzUrlsFromSitemap(
  sitemapUrl: string,
  take: number,
  options: {
    skipEntries?: number;
    predicate?: (url: string) => boolean;
    maxScanAfterSkip?: number;
  } = {}
): Promise<string[]> {
  const skipEntries = Math.max(0, Math.floor(options.skipEntries ?? 0));
  const takeN = Math.max(0, Math.floor(take));
  const predicate = options.predicate ?? urlPathSuggestsWearCategory;
  const unbounded = takeN >= SITEMAP_UNBOUNDED_TAKE;
  const maxScanAfterSkip = unbounded
    ? Number.MAX_SAFE_INTEGER
    : Math.min(
        150_000,
        Math.max(takeN * 100, options.maxScanAfterSkip ?? 80_000)
      );

  const xml = await fetchMotoblouzSitemapXml(sitemapUrl);
  const out: string[] = [];
  let index = 0;
  SITEMAP_LOC_REGEX.lastIndex = 0;
  for (const m of xml.matchAll(SITEMAP_LOC_REGEX)) {
    const u = (m[1] ?? "").trim();
    if (!u) continue;
    index++;
    if (index <= skipEntries) continue;
    if (predicate(u)) out.push(u);
    if (!unbounded && out.length >= takeN) break;
    if (index > skipEntries + maxScanAfterSkip) break;
  }
  return out;
}

/**
 * Comme `collectMotoblouzUrlsFromSitemap`, mais parcourt tous les
 * `sitemap-product-*.xml` listés dans l’index (ordre numérique).
 */
export async function collectMotoblouzUrlsFromSitemapIndex(
  indexUrl: string,
  take: number,
  options: {
    skipEntries?: number;
    predicate?: (url: string) => boolean;
    maxScanAfterSkip?: number;
  } = {}
): Promise<string[]> {
  const files = await resolveMotoblouzProductSitemapUrls(indexUrl);
  if (files.length === 0) {
    throw new Error(`Aucun sitemap-product-*.xml dans l’index : ${indexUrl}`);
  }
  const skipEntries = Math.max(0, Math.floor(options.skipEntries ?? 0));
  const takeN = Math.max(0, Math.floor(take));
  const predicate = options.predicate ?? urlPathSuggestsWearCategory;
  const unbounded = takeN >= SITEMAP_UNBOUNDED_TAKE;
  const maxScanAfterSkip =
    options.maxScanAfterSkip ??
    (unbounded
      ? Number.MAX_SAFE_INTEGER
      : Math.min(2_500_000, Math.max(takeN * 100, 80_000)));

  const out: string[] = [];
  let index = 0;
  outer: for await (const u of iterateMotoblouzProductPageUrlsFromSitemaps(
    files
  )) {
    index++;
    if (index <= skipEntries) continue;
    if (predicate(u)) out.push(u);
    if (!unbounded && out.length >= takeN) break outer;
    if (index > skipEntries + maxScanAfterSkip) break outer;
  }
  return out;
}

export async function extractMotoblouzFromUrl(
  url: string
): Promise<MotoblouzExtracted | null> {
  const html = await fetchMotoblouzProductPage(url);
  return parseMotoblouzHtml(html, url);
}

export async function upsertMotoblouzProduct(
  supabase: SupabaseClient,
  data: MotoblouzExtracted,
  productUrl: string
): Promise<{ productId: string }> {
  const nowIso = new Date().toISOString();

  const payload = {
    canonical_slug: data.canonical_slug,
    brand: data.brand,
    model: data.model,
    category: data.category,
    image_url: data.image,
    ean_code: data.identifier,
    is_accessory: false,
    updated_at: nowIso,
  };

  const { data: existing, error: findErr } = await supabase
    .from("products")
    .select("id")
    .eq("canonical_slug", data.canonical_slug)
    .maybeSingle();

  if (findErr) {
    throw new Error(`products lookup: ${findErr.message}`);
  }

  let productId: string;
  if (existing?.id) {
    productId = existing.id as string;
    const { error: updErr } = await supabase
      .from("products")
      .update(payload)
      .eq("id", productId);
    if (updErr) throw new Error(`products update: ${updErr.message}`);
  } else {
    const { data: created, error: insErr } = await supabase
      .from("products")
      .insert(payload)
      .select("id")
      .single();
    if (insErr || !created?.id) {
      throw new Error(
        `products insert: ${insErr?.message ?? "ligne absente après insert"}`
      );
    }
    productId = created.id as string;
  }

  const { error: priceErr } = await supabase.from("retailer_prices").upsert(
    {
      product_id: productId,
      retailer_name: "Motoblouz",
      price: data.price,
      availability: null,
      url: productUrl,
      observed_at: nowIso,
    },
    { onConflict: "product_id,retailer_name,url" }
  );

  if (priceErr) {
    throw new Error(`retailer_prices upsert: ${priceErr.message}`);
  }

  return { productId };
}
