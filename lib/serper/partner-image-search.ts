/**
 * Recherche d’images via Serper : base titre strict 50 (tout domaine), +50 partenaires,
 * +20 si titre « propre », dimensions mini 350 px si connues.
 * @see https://serper.dev/
 */

import type { ClipPipelineDebug } from "@/lib/ai/vision-service";

export const SERPER_IMAGES_URL = "https://google.serper.dev/images";
export type { ClipPipelineDebug } from "@/lib/ai/vision-service";

/** Toutes les dimensions ≥ cette valeur sont jugées OK pour l’UI (aperçu produit). */
const MIN_IMAGE_DIMENSION = 350;

/**
 * Serper Images : au-delà (~20–30 selon l’offre), la requête peut renvoyer 400
 * « Query not allowed » — rester à 20 pour rester compatible.
 */
export const SERPER_IMAGE_CANDIDATE_LIMIT = 20;

/** Nombre max de candidats texte-scoring envoyés au filtre vision CLIP (après filtre 1 site / 1 visuel). */
export const SERPER_VISION_INPUT_LIMIT = 20;

/** Nombre max d’URLs renvoyées à l’UI après vision (dé-doublonnage + contenu). */
export const SERPER_VISION_OUTPUT_LIMIT = 6;

const SCORE_MIN_FIRST_PASS = 80;
const SCORE_MIN_SECOND_PASS = 50;

/** Groupes de synonymes (minuscules) pour le rapprochement titre / modèle. */
const SYNONYM_GROUPS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(["leather", "cuir"]),
  new Set(["veste", "blouson"]),
];

export type SerperImagesErrorBody = {
  message?: string;
};

export type SerperImageItem = {
  title?: string;
  imageUrl?: string;
  link?: string;
  domain?: string;
  imageWidth?: number;
  imageHeight?: number;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  /** Extrait / description court parfois fourni par Serper. */
  snippet?: string;
  /** Prix affiché par la source (nombre ou libellé type « 299,99 € »). */
  price?: string | number;
};

export type SerperImagesApiResponse = {
  images?: SerperImageItem[];
  error?: SerperImagesErrorBody;
};

/** Réponse JSON du proxy `/api/serper-images` (consommée par le hook client). */
export type PartnerImageSearchJson =
  | {
      ok: true;
      imageUrls: string[];
      imageUrl: string;
      /** Moyenne des prix EUR détectés sur les candidats texte (titres, snippets, champ price). */
      estimatedMarketPriceEur: number | null;
      /** Titres Serper alignés sur `imageUrls` (même ordre post-CLIP). */
      imageGalleryMeta: { url: string; title: string }[];
      /** Détail filtre CLIP (uniquement en développement). */
      clipDebug?: ClipPipelineDebug & {
        clipFailed?: boolean;
        clipErrorMessage?: string;
        usedTextOnlyFallback?: boolean;
      };
    }
  | { ok: false; error: { message: string; code: number } };

/**
 * Requête Serper en « exact phrase » : le texte entier est passé entre guillemets.
 */
export function buildExactMatchImageQuery(userQuery: string): string {
  const inner = userQuery
    .trim()
    .replace(/"/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!inner) return "";
  return `"${inner}"`;
}

/** 5 familles : requête Google, CLIP et mots interdits (serper-images). */
export const SERPER_EQUIPMENT_CATEGORIES = [
  "helmets",
  "jackets",
  "pants",
  "boots",
  "gloves",
] as const;

export type SerperEquipmentCategory = (typeof SERPER_EQUIPMENT_CATEGORIES)[number];

export type ClipPromptTriplet = {
  clipSingular: string;
  relevance: string;
  labelFullProduct: string;
  labelCloseUp: string;
};

const SERPER_QUERY_SUFFIX: Record<SerperEquipmentCategory, string> = {
  helmets: "casque complet",
  jackets: "blouson entier",
  pants: "pantalon entier",
  boots: "paire de bottes",
  gloves: "paire de gants",
};

const CLIP_CATEGORY_SINGULAR: Record<SerperEquipmentCategory, string> = {
  helmets: "helmet",
  jackets: "jacket",
  pants: "pants",
  boots: "boot",
  gloves: "glove",
};

/** UI estimateur (fr) → clé Serper / CLIP. */
const UI_EQUIPMENT_TO_SERPER: Readonly<Record<string, SerperEquipmentCategory>> =
  {
    casque: "helmets",
    blouson: "jackets",
    pantalon: "pants",
    bottes: "boots",
    gants: "gloves",
  };

export function uiEquipmentToSerperCategory(
  equipmentId: string
): SerperEquipmentCategory {
  const k = equipmentId.trim().toLowerCase();
  const hit = UI_EQUIPMENT_TO_SERPER[k];
  if (hit) return hit;
  if (process.env.NODE_ENV === "development") {
    console.warn(
      `[partner-image-search] catégorie UI inconnue « ${equipmentId} », repli helmets.`
    );
  }
  return "helmets";
}

/**
 * Requête envoyée à Serper : phrase exacte marque/modèle + suffixe produit fini (FR).
 */
export function buildSerperImageQuery(
  userQuery: string,
  category: SerperEquipmentCategory
): string {
  const exact = buildExactMatchImageQuery(userQuery);
  if (!exact) return "";
  const suffix = SERPER_QUERY_SUFFIX[category]?.trim();
  if (!suffix) return exact;
  return `${exact} ${suffix}`.trim();
}

/**
 * Triplets pour CLIP : pertinence « moto », vue complète vs gros plan accessoire.
 */
export function getClipPromptTriplet(
  category: SerperEquipmentCategory
): ClipPromptTriplet {
  const singular = CLIP_CATEGORY_SINGULAR[category];
  return {
    clipSingular: singular,
    relevance: `motorcycle ${singular}`,
    labelFullProduct: `A professional studio photo of a complete ${singular}`,
    labelCloseUp: `A close-up photo of a part, accessory, or detail of a ${singular}`,
  };
}

type CategoryNegativeRules = {
  /** Sous-chaînes après normalisation (sans accents, ponctuation → espaces). */
  phrases: readonly string[];
  /** Jetons entiers (titre tokenisé normalisé). Ex. « vis » seul, pas « visière ». */
  wholeWords: readonly string[];
};

const CATEGORY_NEGATIVE_RULES: Record<
  SerperEquipmentCategory,
  CategoryNegativeRules
> = {
  helmets: {
    phrases: [
      "visiere",
      "ecran",
      "pinlock",
      "mousse",
      "intercom",
    ],
    wholeWords: ["vis"],
  },
  jackets: {
    phrases: ["dorsale", "protection", "savon", "doublure"],
    wholeWords: [],
  },
  pants: {
    phrases: [
      "chaussettes",
      "socks",
      "ceinture",
      "sliders",
      "genouilleres",
    ],
    wholeWords: [],
  },
  boots: {
    phrases: ["lacets", "semelles", "savonnettes", "sliders"],
    wholeWords: [],
  },
  gloves: {
    phrases: ["sous-gants", "nettoyant"],
    wholeWords: [],
  },
};

function nfAsciiLower(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Titre et règles dans le même espace : minuscules, sans accents, séparateurs → espaces. */
function normalizeForNegativeTitle(title: string): string {
  return nfAsciiLower(title)
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNegativePhrase(phrase: string): string {
  return normalizeForNegativeTitle(phrase.replace(/-/g, " "));
}

export function titleHasCategoryNegativeKeyword(
  title: string,
  category: SerperEquipmentCategory
): boolean {
  if (!title.trim()) return false;
  const rules = CATEGORY_NEGATIVE_RULES[category];
  const normTitle = normalizeForNegativeTitle(title);
  for (const ph of rules.phrases) {
    const needle = normalizeNegativePhrase(ph);
    if (needle.length > 0 && normTitle.includes(needle)) return true;
  }
  if (rules.wholeWords.length > 0) {
    const tokens = new Set(normTitle.split(" ").filter(Boolean));
    for (const w of rules.wholeWords) {
      const nw = normalizeNegativePhrase(w);
      if (nw && tokens.has(nw)) return true;
    }
  }
  return false;
}

/**
 * Premier mot = marque (telle que saisie), le reste = mots du modèle.
 */
export function splitBrandModel(userQuery: string): {
  brand: string;
  modelWords: string[];
} | null {
  const parts = userQuery.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const brand = parts[0].toLowerCase();
  const modelWords = parts.slice(1).map((p) => p.toLowerCase());
  return { brand, modelWords };
}

function synonymVariants(word: string): string[] {
  const lower = word.toLowerCase();
  for (const g of SYNONYM_GROUPS) {
    if (g.has(lower)) return [...g];
  }
  return [lower];
}

/** Un mot du modèle est reconnu dans le titre s’il ou un synonyme y apparaît. */
function modelWordAppearsInTitle(word: string, titleLower: string): boolean {
  return synonymVariants(word).some((v) => titleLower.includes(v));
}

function titleStrictMatchBrandModel(
  title: string | undefined,
  brand: string,
  modelWords: string[]
): boolean {
  if (!title?.trim()) return false;
  const t = title.toLowerCase();
  if (!t.includes(brand)) return false;
  for (const w of modelWords) {
    if (!modelWordAppearsInTitle(w, t)) return false;
  }
  return true;
}

/** Mot « principal » = le plus long parmi les mots du modèle (ex-aequo : le premier). */
function principalModelKeyword(modelWords: string[]): string | null {
  if (modelWords.length === 0) return null;
  let best = modelWords[0];
  for (let i = 1; i < modelWords.length; i++) {
    if (modelWords[i].length > best.length) best = modelWords[i];
  }
  return best;
}

/** Passe 2 : marque + au moins le mot principal du modèle (synonymes inclus). */
function titleRelaxedMatchBrandModel(
  title: string | undefined,
  brand: string,
  modelWords: string[]
): boolean {
  if (!title?.trim()) return false;
  const t = title.toLowerCase();
  if (!t.includes(brand)) return false;
  if (modelWords.length === 0) return true;
  const main = principalModelKeyword(modelWords);
  if (!main) return true;
  return modelWordAppearsInTitle(main, t);
}

function resolveHostname(item: SerperImageItem): string {
  const domain = item.domain?.trim();
  if (domain) {
    return domain.replace(/^www\./i, "").toLowerCase();
  }
  const link = item.link;
  if (typeof link === "string" && link.trim()) {
    try {
      return new URL(link).hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      /* ignore */
    }
  }
  const img = item.imageUrl;
  if (typeof img === "string" && img.trim()) {
    try {
      return new URL(img).hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      /* ignore */
    }
  }
  return "";
}

function isTrustedMerchantOrOfficialHost(host: string): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  return (
    h.includes("dafy") ||
    h.includes("motoblouz") ||
    h.includes("icasque") ||
    h.includes("speedway") ||
    /\bpkr\./.test(h) ||
    h.endsWith(".pkr.fr") ||
    h.includes("alpinestars") ||
    h.includes("furygan") ||
    h.includes("dainese")
  );
}

const TITLE_PARASITE_RE = [
  /\boccasion\b/i,
  /\bforum\b/i,
  /\bbon\s+coin\b/i,
  /\bleboncoin\b/i,
  /\bebay\b/i,
  /\breview\b/i,
  /\bpromo\b/i,
  /\[\s*obs\s*\]/i,
  /\blegacy\b/i,
  /\barchive\b/i,
  /\bout\s+of\s+stock\b/i,
] as const;

function titleHasParasiteWords(title: string): boolean {
  return TITLE_PARASITE_RE.some((re) => re.test(title));
}

/**
 * Indices « macro / zoom » dans l’URL uniquement (sans « detail » : présent partout en e-commerce).
 */
const URL_MACRO_HINT_FRAGMENTS: ReadonlyArray<string> = [
  "zoom",
  "macro",
  "close-up",
  "closeup",
  "close_up",
  "gros-plan",
  "grosplan",
];

/** Mots entiers dans le titre (après normalisation) = souvent gros plan / fragment. */
/** Mots réservés aux fiches « gros plan » ; on évite texture/fermeture/doublure (très fréquents sur fiches normales). */
const TITLE_MACRO_WORDS = new Set<string>([
  "zoom",
  "detail",
  "details",
  "closeup",
  "partie",
]);

function normalizeForAntiDetail(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[-_\s]+/g, " ")
    .trim();
}

function imageUrlSuggestsMacroShot(imageUrl: string): boolean {
  const hay = normalizeForAntiDetail(imageUrl).replace(/\s/g, "");
  return URL_MACRO_HINT_FRAGMENTS.some((frag) => {
    const f = frag.replace(/[-_\s]/g, "");
    return f.length > 0 && hay.includes(f);
  });
}

function titleSuggestsMacroOrDetailShot(title: string): boolean {
  const tRaw = title.toLowerCase();
  if (/\bclose[\s-]?up\b/i.test(title) || tRaw.includes("gros plan")) {
    return true;
  }
  const t = normalizeForAntiDetail(title);
  const words = t.split(/\s+/).filter(Boolean);
  for (const w of words) {
    if (TITLE_MACRO_WORDS.has(w)) return true;
  }
  return false;
}

/** Filtre anti-gros-plan : titre = mots ; URL = indices stricts seulement (pas « detail » générique). */
function titleOrUrlSuggestsDetailShot(title: string, imageUrl: string): boolean {
  return (
    titleSuggestsMacroOrDetailShot(title) || imageUrlSuggestsMacroShot(imageUrl)
  );
}

function parseDimension(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function imageDimensions(item: SerperImageItem): { w: number; h: number } {
  const w = parseDimension(item.imageWidth) || parseDimension(item.thumbnailWidth);
  const h = parseDimension(item.imageHeight) || parseDimension(item.thumbnailHeight);
  return { w, h };
}

function isPortraitAspect(w: number, h: number): boolean {
  if (w <= 0 || h <= 0) return false;
  return h > w;
}

/** Match titre strict (tous les mots du modèle) : base 50 — tout site peut atteindre le seuil P2. */
const SCORE_BASE_STRICT_TITLE = 50;
/** Passe 2 « relâchée » (marque + mot principal) : base plus basse. */
const SCORE_BASE_RELAXED_TITLE = 35;
/** Sites partenaires / officiels : +50 pour passer avant tout site générique au même titre. */
const SCORE_BONUS_TRUSTED = 50;
/** Titre sans signal « occasion / legacy… » : préférence vs un autre candidat équivalent. */
const SCORE_BONUS_CLEAN_TITLE = 20;

function computeImageScore(
  item: SerperImageItem,
  title: string,
  matchTier: "strict" | "relaxed"
): number {
  let score =
    matchTier === "strict" ? SCORE_BASE_STRICT_TITLE : SCORE_BASE_RELAXED_TITLE;
  const host = resolveHostname(item);
  if (isTrustedMerchantOrOfficialHost(host)) score += SCORE_BONUS_TRUSTED;
  if (!titleHasParasiteWords(title)) score += SCORE_BONUS_CLEAN_TITLE;
  const { w, h } = imageDimensions(item);
  if (isPortraitAspect(w, h)) score -= 10;
  return score;
}

/**
 * Tri : score d’abord (passe 1 à 80 bat toute passe 2 à 50 car appels séquentiels).
 * À score égal, on ne privilégie plus la « HD » : uniquement la surface en départage faible.
 */
function compareCandidates(
  a: { score: number; area: number },
  b: { score: number; area: number }
): number {
  if (b.score !== a.score) return b.score - a.score;
  return b.area - a.area;
}

export type SerperCandidateEval = {
  item: SerperImageItem;
  title: string;
  url: string;
  strictOk: boolean;
  relaxedOk: boolean;
  score1: number;
  score2: number;
  area: number;
  meetsHd: boolean;
};

function buildRejectionReason(
  e: SerperCandidateEval,
  chosenUrl: string | null
): string {
  if (chosenUrl && e.url !== chosenUrl) {
    if (e.strictOk && e.score1 >= SCORE_MIN_FIRST_PASS) {
      return `Passe 1: score ${e.score1} — non retenu (ex-aequo : tri surface)`;
    }
    if (e.relaxedOk && e.score2 >= SCORE_MIN_SECOND_PASS) {
      return `Passe 2: score ${e.score2} — non retenu (ex-aequo : tri surface)`;
    }
  }

  const parts: string[] = [];
  if (e.strictOk) {
    if (e.score1 < SCORE_MIN_FIRST_PASS) {
      parts.push(
        `Passe 1: score ${e.score1} — seuil ${SCORE_MIN_FIRST_PASS} non atteint`
      );
    }
  } else {
    parts.push(
      "Passe 1: refus — marque ou mot modèle manquant (tous les mots requis)"
    );
  }
  if (e.relaxedOk) {
    if (e.score2 < SCORE_MIN_SECOND_PASS) {
      parts.push(
        `Passe 2: score ${e.score2} — seuil ${SCORE_MIN_SECOND_PASS} non atteint`
      );
    }
  } else {
    parts.push(
      "Passe 2: refus — marque ou mot principal du modèle absent du titre"
    );
  }
  return parts.join(" | ");
}

function logTopRejected(
  evaluated: SerperCandidateEval[],
  chosenUrl: string | null
): void {
  if (process.env.NODE_ENV !== "development") return;

  const ranked = [...evaluated].sort((a, b) => {
    const maxA = Math.max(
      a.strictOk ? a.score1 : -1,
      a.relaxedOk ? a.score2 : -1
    );
    const maxB = Math.max(
      b.strictOk ? b.score1 : -1,
      b.relaxedOk ? b.score2 : -1
    );
    return maxB - maxA;
  });

  const rejected = ranked
    .filter((e) => e.url !== chosenUrl)
    .slice(0, 3);

  if (rejected.length === 0) {
    console.log("[pickBestSerperImageUrl] Aucun candidat rejeté à lister.");
    return;
  }

  const lines = rejected.map((e) => ({
    title: e.title.slice(0, 80) + (e.title.length > 80 ? "…" : ""),
    url: e.url,
    raison: buildRejectionReason(e, chosenUrl),
  }));
  console.log("[pickBestSerperImageUrl] 3 meilleurs candidats rejetés:", lines);
}

function pickWinnerFromPass(
  evaluated: SerperCandidateEval[],
  pass: "strict" | "relaxed",
  minScore: number
): string | null {
  const rows: Array<{ url: string; score: number; area: number }> = [];

  for (const e of evaluated) {
    const ok = pass === "strict" ? e.strictOk : e.relaxedOk;
    if (!ok) continue;
    const score = pass === "strict" ? e.score1 : e.score2;
    rows.push({
      url: e.url,
      score,
      area: e.area,
    });
  }

  if (rows.length === 0) return null;

  rows.sort(compareCandidates);
  const best = rows[0];
  if (best.score < minScore) return null;
  return best.url;
}

function normalizePriceToken(raw: string): number | null {
  const t = raw.replace(/\s/g, "").replace(/\u00a0/g, "").replace(",", ".");
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n) || n < 12 || n > 12_000) return null;
  return Math.round(n);
}

/**
 * Extrait des montants plausibles (EUR) depuis titres/extraits Serper.
 */
export function parseEuroAmountsFromText(text: string): number[] {
  if (!text || !text.trim()) return [];
  const normalized = text.replace(/\u00a0/g, " ");
  const found = new Set<number>();
  const patterns = [
    /€\s*(\d{1,3}(?:\s\d{3})*(?:[.,]\d{2})?|\d+[.,]\d{2}|\d+)/gi,
    /(\d{1,3}(?:\s\d{3})*(?:[.,]\d{2})?|\d+[.,]\d{2})\s*€/gi,
    /\bEUR\s*(\d{1,3}(?:\s\d{3})*(?:[.,]\d{2})?|\d+)/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(normalized)) !== null) {
      const raw = m[1]?.trim();
      if (!raw) continue;
      const n = normalizePriceToken(raw);
      if (n != null) found.add(n);
    }
  }
  return [...found];
}

export function extractInferredPriceEurFromSerperItem(
  item: SerperImageItem,
  titleResolved: string
): number | null {
  if (typeof item.price === "number" && Number.isFinite(item.price)) {
    const n = normalizePriceToken(String(item.price));
    if (n != null) return n;
  }
  if (typeof item.price === "string" && item.price.trim()) {
    const fromField = parseEuroAmountsFromText(`${item.price} €`);
    if (fromField.length > 0) {
      return Math.round(
        fromField.reduce((a, b) => a + b, 0) / fromField.length
      );
    }
  }
  const chunks: string[] = [];
  if (titleResolved.trim()) chunks.push(titleResolved);
  if (typeof item.title === "string" && item.title.trim()) chunks.push(item.title);
  if (typeof item.snippet === "string" && item.snippet.trim()) {
    chunks.push(item.snippet);
  }
  const amounts: number[] = [];
  for (const c of chunks) amounts.push(...parseEuroAmountsFromText(c));
  if (amounts.length === 0) return null;
  return Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length);
}

/** Mot-clés listing typiques d’un produit ancien / retiré (titre ou URL d’image). */
const LEGACY_YEAR_IN_TITLE_RE = /\b201[0-9]\b/;
const LEGACY_TEXT_RE =
  /\b(archive|old|discontinued|obsol[eè]te|legacy|vintage)\b/i;

export function detectListingObsolescence(
  title: string,
  imageUrl: string
): boolean {
  const t = title ?? "";
  const u = imageUrl ?? "";
  if (LEGACY_YEAR_IN_TITLE_RE.test(t) || LEGACY_YEAR_IN_TITLE_RE.test(u)) {
    return true;
  }
  const hay = `${t}\n${u}`.toLowerCase();
  return LEGACY_TEXT_RE.test(hay);
}

function gatherEvaluatedCandidates(
  data: SerperImagesApiResponse,
  userQuery: string,
  category: SerperEquipmentCategory
): SerperCandidateEval[] {
  const list = data.images;
  if (!Array.isArray(list) || list.length === 0) return [];

  const bm = splitBrandModel(userQuery);
  if (bm == null) return [];

  const slice = list.slice(0, SERPER_IMAGE_CANDIDATE_LIMIT);
  const evaluated: SerperCandidateEval[] = [];

  for (const item of slice) {
    const title = item.title;
    if (typeof title !== "string" || !title.trim()) continue;
    if (titleHasCategoryNegativeKeyword(title, category)) continue;
    const raw = item.imageUrl;
    if (typeof raw !== "string") continue;
    const url = raw.trim();
    if (!url) continue;

    const strictOk = titleStrictMatchBrandModel(title, bm.brand, bm.modelWords);
    const relaxedOk = titleRelaxedMatchBrandModel(title, bm.brand, bm.modelWords);

    if (!strictOk && !relaxedOk) continue;
    if (titleOrUrlSuggestsDetailShot(title, url)) continue;

    const { w, h } = imageDimensions(item);
    if (
      w > 0 &&
      h > 0 &&
      (w < MIN_IMAGE_DIMENSION || h < MIN_IMAGE_DIMENSION)
    ) {
      continue;
    }

    const scoreStrict = computeImageScore(item, title, "strict");
    const scoreRelaxed = computeImageScore(item, title, "relaxed");
    const score1 = strictOk ? scoreStrict : 0;
    const score2 = relaxedOk ? (strictOk ? scoreStrict : scoreRelaxed) : 0;

    const area = w > 0 && h > 0 ? w * h : 0;
    const meetsHd = w >= MIN_IMAGE_DIMENSION && h >= MIN_IMAGE_DIMENSION;

    evaluated.push({
      item,
      title,
      url,
      strictOk,
      relaxedOk,
      score1,
      score2,
      area,
      meetsHd,
    });
  }

  return evaluated;
}

/** Candidat texte + lien page marchand (pour dédoublonner hors vision). */
export type SerperVisionCandidate = {
  url: string;
  title: string;
  /** URL de la page source Serper (souvent fiche produit) — même page = même offre. */
  sourcePageUrl?: string;
};

function imageAssetDedupeKey(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    u.search = "";
    return `${u.hostname.toLowerCase()}|${u.pathname.toLowerCase()}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function sourcePageDedupeKey(pageUrl: string): string | null {
  const t = pageUrl.trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    u.hash = "";
    u.search = "";
    const path = u.pathname.replace(/\/$/, "") || "/";
    return `${u.origin.toLowerCase()}${path.toLowerCase()}`;
  } catch {
    return null;
  }
}

/** Host marchand ou CDN déduit de la fiche ou de l’URL d’image. */
function visionCandidateHost(row: SerperVisionCandidate): string {
  const page = row.sourcePageUrl?.trim();
  if (page) {
    try {
      return new URL(page).hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      /* ignore */
    }
  }
  try {
    return new URL(row.url.trim()).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Titres dont >80 % des mots (Jaccard sur tokens) se chevauchent = même proposition textuelle. */
const TITLE_WORD_JACCARD_DEDUP_MIN = 0.8;

function cleanTitleWordSet(title: string): Set<string> {
  const t = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return new Set();
  return new Set(t.split(" ").filter(Boolean));
}

function wordSetJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const w of a) {
    if (b.has(w)) inter += 1;
  }
  const u = a.size + b.size - inter;
  return u === 0 ? 0 : inter / u;
}

/**
 * Réduit les doublons avant CLIP : **un domaine = une image**, même fiche, même fichier,
 * titres quasi identiques (>80 % Jaccard). Ordre d’entrée = pertinence Serper.
 */
export function dedupeEligibleForVisionCandidates(
  rows: SerperVisionCandidate[]
): SerperVisionCandidate[] {
  const seenDomains = new Set<string>();
  const seenPages = new Set<string>();
  const seenAssets = new Set<string>();
  const keptTitleWordSets: Set<string>[] = [];
  const out: SerperVisionCandidate[] = [];

  rowLoop: for (const row of rows) {
    const host = visionCandidateHost(row);
    if (host && seenDomains.has(host)) continue;

    if (row.sourcePageUrl) {
      const pk = sourcePageDedupeKey(row.sourcePageUrl);
      if (pk && seenPages.has(pk)) continue;
    }

    const ak = imageAssetDedupeKey(row.url);
    if (seenAssets.has(ak)) continue;

    const words = cleanTitleWordSet(row.title);
    for (const prev of keptTitleWordSets) {
      if (wordSetJaccard(words, prev) > TITLE_WORD_JACCARD_DEDUP_MIN) {
        continue rowLoop;
      }
    }

    if (row.sourcePageUrl) {
      const pk = sourcePageDedupeKey(row.sourcePageUrl);
      if (pk) seenPages.add(pk);
    }
    seenAssets.add(ak);
    if (host) seenDomains.add(host);
    out.push(row);
    keptTitleWordSets.push(words);
  }

  return out;
}

/**
 * Un seul passage `gather` : candidats vision + moyenne de prix marché déduite des mêmes entrées.
 */
export function prepareSerperVisionPipeline(
  data: SerperImagesApiResponse,
  userQuery: string,
  limit: number,
  category: SerperEquipmentCategory
): {
  eligible: SerperVisionCandidate[];
  estimatedMarketPriceEur: number | null;
} {
  const evaluated = gatherEvaluatedCandidates(data, userQuery, category);

  const priceSamples: number[] = [];
  for (const e of evaluated) {
    const p = extractInferredPriceEurFromSerperItem(e.item, e.title);
    if (p != null) priceSamples.push(p);
  }
  const estimatedMarketPriceEur =
    priceSamples.length === 0
      ? null
      : Math.round(
          priceSamples.reduce((a, b) => a + b, 0) / priceSamples.length
        );

  const eligible = evaluated.filter(
    (e) =>
      (e.strictOk && e.score1 >= SCORE_MIN_FIRST_PASS) ||
      (e.relaxedOk && e.score2 >= SCORE_MIN_SECOND_PASS)
  );

  eligible.sort((a, b) => {
    const aP1 = a.strictOk && a.score1 >= SCORE_MIN_FIRST_PASS;
    const bP1 = b.strictOk && b.score1 >= SCORE_MIN_FIRST_PASS;
    if (aP1 !== bP1) return aP1 ? -1 : 1;
    const sa = aP1 ? a.score1 : a.score2;
    const sb = bP1 ? b.score1 : b.score2;
    if (sb !== sa) return sb - sa;
    return b.area - a.area;
  });

  const seenHosts = new Set<string>();
  const diversified: SerperCandidateEval[] = [];
  for (const e of eligible) {
    if (diversified.length >= limit) break;
    const host = resolveHostname(e.item);
    if (host) {
      if (seenHosts.has(host)) continue;
      seenHosts.add(host);
    }
    diversified.push(e);
  }

  const eligibleRows = diversified.map((e) => {
    const link = e.item.link;
    return {
      url: e.url,
      title: e.title,
      sourcePageUrl:
        typeof link === "string" && link.trim() ? link.trim() : undefined,
    };
  });

  return { eligible: eligibleRows, estimatedMarketPriceEur };
}

/**
 * Candidats éligibles (passe 1 ou 2), triés pour la vision : P1 d’abord, puis score, puis surface.
 */
export function listEligibleSerperCandidates(
  data: SerperImagesApiResponse,
  userQuery: string,
  limit: number,
  category: SerperEquipmentCategory
): SerperVisionCandidate[] {
  return prepareSerperVisionPipeline(data, userQuery, limit, category).eligible;
}

/**
 * Passe 1 (strict + seuil 80), puis passe 2 (marque + mot principal + seuil 50).
 */
export function pickBestSerperImageUrl(
  data: SerperImagesApiResponse,
  userQuery: string,
  category: SerperEquipmentCategory = "helmets"
): string | null {
  const evaluated = gatherEvaluatedCandidates(data, userQuery, category);

  if (evaluated.length === 0) {
    if (process.env.NODE_ENV === "development") {
      console.log(
        "[pickBestSerperImageUrl] Aucun candidat (titre strict / relâché KO pour les 20 entrées)."
      );
    }
    return null;
  }

  let chosen: string | null = pickWinnerFromPass(
    evaluated,
    "strict",
    SCORE_MIN_FIRST_PASS
  );
  if (chosen == null) {
    chosen = pickWinnerFromPass(
      evaluated,
      "relaxed",
      SCORE_MIN_SECOND_PASS
    );
  }

  logTopRejected(evaluated, chosen);

  return chosen;
}
