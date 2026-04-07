import {
  LOGISTICS_FIXED_EUR,
  CATEGORY_RESIDUAL_FACTOR,
  CONDITION_WEIGHT,
  resellerMarginRateForRetail,
  type PricingCategory,
} from "@/config/business";

export type { PricingCategory } from "@/config/business";

/**
 * Montant **affiché au vendeur** : ce que tu lui verses (recommerce).
 * Tu as déjà retiré ta marge de revente et les frais fixes du « gâteau » résiduel.
 *
 * B = prix_neuf × α_cat × α_état
 * offre = max(0, arrondi(B × (1 − marge_repriseur)) − frais_fixes)
 */
export function computeRetailNetOffer(
  retailPrice: number,
  category: string,
  condition: string
): number {
  const cat = category as PricingCategory;
  const alphaCat = CATEGORY_RESIDUAL_FACTOR[cat] ?? 0.7;
  const alphaEtat = CONDITION_WEIGHT[condition] ?? 0.75;
  const residualBase = retailPrice * alphaCat * alphaEtat;
  const marginRate = resellerMarginRateForRetail(retailPrice, cat);
  const afterMargin = residualBase * (1 - marginRate);
  return Math.max(0, Math.round(afterMargin - LOGISTICS_FIXED_EUR));
}
