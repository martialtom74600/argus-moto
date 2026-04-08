import {
  AGE_LIMITS_BY_CATEGORY,
  CATEGORY_DISPLAY_PLURAL,
  type EquipmentCategoryId,
} from "@/lib/business/rules";

export type CleanMedianResult = {
  median: number | null;
  confidenceScore: number;
  totalCount: number;
  validCount: number;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const v =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  return Math.round(v * 100) / 100;
}

export function calculateCleanMedian(prices: number[]): CleanMedianResult {
  const cleanInput = prices.filter((p) => Number.isFinite(p) && p > 0);
  const totalCount = cleanInput.length;
  if (totalCount === 0) {
    return { median: null, confidenceScore: 0, totalCount: 0, validCount: 0 };
  }

  const rawMedian = median(cleanInput);
  if (rawMedian == null || rawMedian <= 0) {
    return { median: null, confidenceScore: 0, totalCount, validCount: 0 };
  }

  const minBound = rawMedian * 0.6;
  const maxBound = rawMedian * 1.4;
  const valid = cleanInput.filter((p) => p >= minBound && p <= maxBound);
  const finalMedian = median(valid.length > 0 ? valid : cleanInput);
  const validCount = valid.length > 0 ? valid.length : cleanInput.length;
  const confidenceScore = Math.round((validCount / totalCount) * 100);

  return {
    median: finalMedian,
    confidenceScore: Math.max(0, Math.min(100, confidenceScore)),
    totalCount,
    validCount,
  };
}

export type PurchaseYearGateFailure = {
  ok: false;
  blockReason: "TOO_OLD";
  maxAgeYears: number;
  categoryDisplayPlural: string;
};

export type PurchaseYearGateResult =
  | { ok: true }
  | PurchaseYearGateFailure;

/**
 * Âge = année de référence − année d’achat. Au-delà du plafond catégorie → pas d’offre cash.
 */
export function evaluatePurchaseYearGate(
  category: EquipmentCategoryId,
  purchaseYear: number,
  referenceYear: number = new Date().getFullYear()
): PurchaseYearGateResult {
  const limit = AGE_LIMITS_BY_CATEGORY[category];
  const age = referenceYear - purchaseYear;
  if (age > limit) {
    return {
      ok: false,
      blockReason: "TOO_OLD",
      maxAgeYears: limit,
      categoryDisplayPlural: CATEGORY_DISPLAY_PLURAL[category],
    };
  }
  return { ok: true };
}

const USER_PRICE_VS_MARKET_MAX_RATIO = 1.2;

export type UserPriceValidationResult = {
  effectiveRetailEur: number;
  priceAdjustedByMarket: boolean;
  adjustMessage?: string;
};

export type UserPriceValidationOptions = {
  /** Listing archive (URL) : la cote Serper prime sur une saisie trop élevée. */
  listingAppearsArchived?: boolean;
};

/**
 * Si le prix déclaré dépasse nettement la cote extraite du marché, on plafonne sur la cote (honnêteté).
 * Si la fiche ressemble à une archive et que la cote est inférieure à la saisie, plafond sur la cote + message historique.
 */
export function validateUserPrice(
  userPrice: number,
  estimatedMarketPrice: number | null | undefined,
  options?: UserPriceValidationOptions
): UserPriceValidationResult {
  const em = estimatedMarketPrice;
  const marketOk =
    em != null && Number.isFinite(em) && em > 0;
  const marketRounded = marketOk ? Math.round(Number(em)) : 0;

  if (options?.listingAppearsArchived === true && marketOk && userPrice > marketRounded) {
    return {
      effectiveRetailEur: marketRounded,
      priceAdjustedByMarket: true,
      adjustMessage: `Prix neuf ajusté selon nos bases de données historiques (${marketRounded} €).`,
    };
  }

  if (!marketOk) {
    return { effectiveRetailEur: userPrice, priceAdjustedByMarket: false };
  }
  const cap = marketRounded * USER_PRICE_VS_MARKET_MAX_RATIO;
  if (userPrice > cap) {
    return {
      effectiveRetailEur: marketRounded,
      priceAdjustedByMarket: true,
      adjustMessage: "Prix ajusté selon la cote du marché",
    };
  }
  return { effectiveRetailEur: userPrice, priceAdjustedByMarket: false };
}
