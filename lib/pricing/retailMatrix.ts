import {
  LOGISTICS_FIXED_EUR,
  CATEGORY_RESIDUAL_FACTOR,
  CONDITION_WEIGHT,
  resellerMarginRateForRetail,
  type PricingCategory,
} from "@/config/business";

export type { PricingCategory } from "@/config/business";

/** B = prix neuf (ajusté) × α_cat × α_état — valeur résiduelle avant marge rachat. */
function residualBaseValue(
  retailPrice: number,
  category: string,
  condition: string
): number {
  const cat = category as PricingCategory;
  const alphaCat = CATEGORY_RESIDUAL_FACTOR[cat] ?? 0.7;
  const alphaEtat = CONDITION_WEIGHT[condition] ?? 0.75;
  return retailPrice * alphaCat * alphaEtat;
}

/**
 * Ordre de grandeur de **revente occasion** (même base que l’offre, sans marge ni frais fixes).
 * Affichage transparent : « vers combien on peut repositionner l’article » côté marché.
 */
export function computeResidualReferenceEur(
  retailPrice: number,
  category: string,
  condition: string
): number {
  return Math.max(
    0,
    Math.round(residualBaseValue(retailPrice, category, condition))
  );
}

/**
 * Montant **affiché au vendeur** : ce que tu lui verses (recommerce).
 * Tu as déjà retiré ta marge de revente et les frais fixes du « gâteau » résiduel.
 *
 * offre = max(0, arrondi(B × (1 − marge_repriseur)) − frais_fixes)
 */
export function computeRetailNetOffer(
  retailPrice: number,
  category: string,
  condition: string
): number {
  const cat = category as PricingCategory;
  const residualBase = residualBaseValue(retailPrice, category, condition);
  const marginRate = resellerMarginRateForRetail(retailPrice, cat);
  const afterMargin = residualBase * (1 - marginRate);
  return Math.max(0, Math.round(afterMargin - LOGISTICS_FIXED_EUR));
}
