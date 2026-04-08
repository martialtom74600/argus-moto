/**
 * Règles métier transverses (plafonds d’âge, libellés).
 */

/** Âge max (années) pour accepter une offre de rachat, par catégorie (clés = formulaire / API). */
export const AGE_LIMITS_BY_CATEGORY = {
  casque: 5,
  blouson: 12,
  pantalon: 10,
  bottes: 8,
  gants: 5,
} as const;

export type EquipmentCategoryId = keyof typeof AGE_LIMITS_BY_CATEGORY;

/** Libellé pluriel (minuscules) pour les messages utilisateur. */
export const CATEGORY_DISPLAY_PLURAL: Record<EquipmentCategoryId, string> = {
  casque: "casques",
  blouson: "blousons",
  pantalon: "pantalons",
  bottes: "bottes",
  gants: "gants",
};
