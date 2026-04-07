/**
 * Paramètres métier centralisés (Smart Margin, états, seuils catalogue).
 * Ajustez ici sans équivalence dans le reste du code.
 */

export type PricingCategory =
  | "casque"
  | "blouson"
  | "gants"
  | "bottes"
  | "pantalon";

/** Forfait transport + reconditionnement (déduit du net vendeur). */
export const LOGISTICS_FIXED_EUR = 15;

/** Affichage « Prix certifié Argus Moto » si match catalogue ≥ ce seuil. */
export const CERTIFIED_ARGUS_MIN_SIMILARITY = 0.9;

/**
 * Pondération état sur le prix de rachat de référence (avant marge plateforme).
 * Clés alignées sur l’API / formulaire.
 */
export const CONDITION_WEIGHT: Record<string, number> = {
  "neuf-etiquette": 1.0,
  "tres-bon": 0.85,
  bon: 0.7,
  "etat-moyen": 0.5,
};

/**
 * Marge plateforme (fraction) pour casque : dégressive sur le prix neuf.
 * < 100 € : 40 % ; entre 100 et 300 € interpolation vers 25 % ; etc.
 */
export function helmetCommissionRate(retailNeuf: number): number {
  if (retailNeuf < 100) return 0.4;
  if (retailNeuf < 300) {
    const t = (retailNeuf - 100) / 200;
    return 0.4 + t * (0.25 - 0.4);
  }
  if (retailNeuf < 600) {
    const t = (retailNeuf - 300) / 300;
    return 0.25 + t * (0.15 - 0.25);
  }
  return 0.15;
}

/** Autres catégories : grille proche, un peu moins agressive sur le bas. */
export function defaultCommissionRate(retailNeuf: number): number {
  if (retailNeuf < 120) return 0.38;
  if (retailNeuf < 350) return 0.3;
  if (retailNeuf < 700) return 0.22;
  return 0.18;
}

export function commissionRateForRetail(
  retailNeuf: number,
  category: PricingCategory
): number {
  if (category === "casque") return helmetCommissionRate(retailNeuf);
  return defaultCommissionRate(retailNeuf);
}
