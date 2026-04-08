/**
 * Détection de listings « archive » (URL) vs année déclarée — cohérence métier.
 */

/** Segment d’URL ressemblant à une année « ancienne » (≤ 2019). */
const PATH_SEGMENT_OLD_YEAR = /\/(19[89]\d|200\d|201[0-9])(?:\/|$)/;

const ARCHIVE_PATH_KEYWORDS =
  /\/(old-collections?|anciennes?-collections?|archives?|archive-collection|discontinued|collections?-archive)\//i;

/**
 * Indique si l’URL de l’image (chemin) évoque une fiche ou média d’archive.
 * Utilisé pour l’ajustement prix historique Serper vs saisie client.
 */
export function urlLooksLikeArchiveListing(url: string): boolean {
  if (typeof url !== "string" || !url.trim()) return false;
  let pathname = "";
  try {
    pathname = new URL(url.trim()).pathname.toLowerCase();
  } catch {
    const u = url.trim().toLowerCase();
    return (
      PATH_SEGMENT_OLD_YEAR.test(u) ||
      ARCHIVE_PATH_KEYWORDS.test(u) ||
      /\bold-collections?\b/i.test(u)
    );
  }
  if (PATH_SEGMENT_OLD_YEAR.test(pathname)) return true;
  if (ARCHIVE_PATH_KEYWORDS.test(pathname)) return true;
  if (/\/old-collections?\/|\/old-collection\//i.test(pathname)) return true;
  return false;
}

export type ProductConsistencyResult = {
  consistent: boolean;
  /** Message affiché si la cohérence est douteuse. */
  userMessage?: string;
  /** Dossier à traiter manuellement côté opérations / UI. */
  requiresManualReview: boolean;
};

/**
 * @param selectedImageUrl URL du visuel retenu (absolu ou relatif côté chemin analysé).
 * @param userDeclaredYear Année d’achat déclarée par l’utilisateur.
 */
export function checkProductConsistency(
  selectedImageUrl: string,
  userDeclaredYear: number
): ProductConsistencyResult {
  if (
    typeof selectedImageUrl !== "string" ||
    !selectedImageUrl.trim() ||
    !Number.isFinite(userDeclaredYear)
  ) {
    return { consistent: true, requiresManualReview: false };
  }

  const archiveUrl = urlLooksLikeArchiveListing(selectedImageUrl);
  if (archiveUrl && userDeclaredYear > 2020) {
    return {
      consistent: false,
      userMessage:
        "Ce modèle semble être une version antérieure à 2020. Veuillez vérifier l’année.",
      requiresManualReview: true,
    };
  }

  return { consistent: true, requiresManualReview: false };
}
