import {
  LOGISTICS_FIXED_EUR,
  CONDITION_WEIGHT,
  commissionRateForRetail,
  type PricingCategory,
} from "@/config/business";

export type { PricingCategory } from "@/config/business";

/**
 * Smart Margin : base = neuf × pondération état ; net = base × (1 − commission) − frais fixes.
 * Commission dégressive sur le neuf (casque) ou grille default (autres catégories).
 */
export function computeRetailNetOffer(
  retailPrice: number,
  category: string,
  condition: string
): number {
  const cat = category as PricingCategory;
  const weight = CONDITION_WEIGHT[condition] ?? 0.75;
  const base = retailPrice * weight;
  const commission = commissionRateForRetail(retailPrice, cat);
  const afterMargin = base * (1 - commission);
  return Math.max(0, Math.round(afterMargin - LOGISTICS_FIXED_EUR));
}
