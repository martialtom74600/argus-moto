const COSMETIC_STOP_WORDS = new Set([
  "noir",
  "mat",
  "black",
  "matt",
  "blanc",
  "white",
  "rouge",
  "red",
  "fluo",
  "yellow",
  "deco",
  "replica",
  "promo",
  "destockage",
]);

function normalizeToken(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function generateCanonicalSlug(brand: string, name: string): string {
  const normalizedBrand = normalizeToken(brand);
  const normalizedName = normalizeToken(name);

  const brandTokens = normalizedBrand
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const nameTokens = normalizedName
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  // Pass 1: retire seulement les adjectifs marketing/couleurs.
  const cleanedName = nameTokens.filter((t) => !COSMETIC_STOP_WORDS.has(t));
  const primary = [...brandTokens, ...cleanedName];

  // Garde-fou: si trop épuré, on conserve le nom brut normalisé.
  const tokens = primary.length >= 2 ? primary : [...brandTokens, ...nameTokens];

  const dedup: string[] = [];
  for (const t of tokens) {
    if (!t) continue;
    if (dedup[dedup.length - 1] !== t) dedup.push(t);
  }
  return dedup.join("-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export const getCanonicalSlug = generateCanonicalSlug;
