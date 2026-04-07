export const BRAND_DYNAMICS = {
  PREMIUM: {
    decay: 0.1,
    brands: ["arai", "shoei", "schuberth"],
  },
  "MID-RANGE": {
    decay: 0.18,
    brands: ["hjc", "shark", "nolan"],
  },
  "BUDGET/ACCESSION": {
    decay: 0.3,
    brands: ["dexter", "all one"],
  },
} as const;

const DEFAULT_DECAY = 0.22;

function inferYearsOld(model: string): number {
  const y = new Date().getFullYear();
  const m = model.match(/\b(19|20)\d{2}\b/);
  if (!m) return 3;
  const modelYear = Number.parseInt(m[0], 10);
  if (!Number.isFinite(modelYear)) return 3;
  return Math.max(0, y - modelYear);
}

export function resolveBrandDecay(brand: string): number {
  const b = brand.trim().toLowerCase();
  for (const group of Object.values(BRAND_DYNAMICS)) {
    if ((group.brands as readonly string[]).includes(b)) return group.decay;
  }
  return DEFAULT_DECAY;
}

export function computeArgusPredictivePrice(
  originalRetail: number,
  model: string,
  brand: string
): number {
  const yearsOld = inferYearsOld(model);
  const decayRate = resolveBrandDecay(brand);
  const value = originalRetail * Math.pow(1 - decayRate, yearsOld);
  return Math.max(45, Math.round(value));
}
