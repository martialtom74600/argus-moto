/**
 * Filtre les lignes Google Shopping pour ne garder que les annonces
 * dont le titre correspond à la fiche produit (marque, modèle, déclinaison).
 */

export function normalizeShoppingText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set([
  "de",
  "du",
  "des",
  "la",
  "le",
  "les",
  "et",
  "pour",
  "avec",
  "sans",
  "en",
  "au",
  "aux",
  "the",
  "a",
  "un",
  "une",
]);

export function listingProductTitle(row: Record<string, unknown>): string {
  const t = row.productTitle;
  return typeof t === "string" ? t : "";
}

function meaningfulTokens(
  brand: string,
  model: string,
  variant?: string
): string[] {
  const raw = normalizeShoppingText(
    [brand, model, variant ?? ""].filter(Boolean).join(" ")
  );
  const toks = raw.split(" ").filter((t) => t.length > 0);
  const out: string[] = [];
  for (const t of toks) {
    if (STOP.has(t)) continue;
    if (t.length >= 2) out.push(t);
    if (/^\d{3,}$/.test(t)) out.push(t);
  }
  return [...new Set(out)];
}

/** Mots de déclinaison : tous doivent apparaître dans le titre (couleur, finition…). */
export function declinaisonTokens(variant: string | undefined): string[] {
  if (!variant?.trim()) return [];
  return normalizeShoppingText(variant)
    .split(" ")
    .filter((t) => t.length >= 2);
}

/**
 * @param minRatio part minimale des jetons marque+modèle+(déclinaison dans le calcul des jetons) retrouvés dans le titre
 */
export function titleMatchesProductListing(
  title: string,
  brand: string,
  model: string,
  variant: string | undefined,
  minRatio: number
): boolean {
  const nt = normalizeShoppingText(title);
  if (!nt) return false;

  const brandParts = normalizeShoppingText(brand)
    .split(" ")
    .filter((t) => !STOP.has(t) && t.length >= 2);
  const brandKey = brandParts[0];
  if (brandKey && !nt.includes(brandKey)) return false;

  const toks = meaningfulTokens(brand, model, variant);
  if (toks.length === 0) return false;

  let hit = 0;
  for (const t of toks) {
    if (nt.includes(t)) hit++;
  }
  if (hit / toks.length < minRatio) return false;

  for (const vt of declinaisonTokens(variant)) {
    if (!nt.includes(vt)) return false;
  }
  return true;
}
