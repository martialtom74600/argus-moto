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
