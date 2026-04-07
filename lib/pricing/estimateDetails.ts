import type { PricingCategory } from "@/config/business";

/** Entrées alignées sur le formulaire / `estimateRequestSchema`. */
export type EstimateDetailInput = {
  helmetAgeBand?: "under-2" | "2-to-5" | "over-5";
  hadImpact?: boolean;
  equipmentSize?: string;
  completeness?: "complete" | "no-box" | "accessories-missing";
  visibleDefects?: boolean;
};

/**
 * Ajuste le prix neuf de référence (avant marge Smart) selon âge casque,
 * complétude et défauts déclarés. Peut forcer une relecture humaine.
 */
export function adjustRetailForEstimateDetails(
  retailNeuf: number,
  category: string,
  d: EstimateDetailInput | undefined
): { adjustedRetail: number; needsReview: boolean } {
  if (!d) {
    return {
      adjustedRetail: retailNeuf,
      needsReview: false,
    };
  }

  let factor = 1;
  let needsReview = false;
  const cat = category as PricingCategory;

  if (cat === "casque" && d.helmetAgeBand) {
    if (d.helmetAgeBand === "2-to-5") factor *= 0.88;
    if (d.helmetAgeBand === "over-5") {
      factor *= 0.72;
      needsReview = true;
    }
  }

  if (d.completeness === "no-box") factor *= 0.96;
  if (d.completeness === "accessories-missing") factor *= 0.9;

  if (d.visibleDefects === true) {
    factor *= 0.85;
    needsReview = true;
  }

  const adjustedRetail = Math.max(45, retailNeuf * factor);
  return { adjustedRetail, needsReview };
}
