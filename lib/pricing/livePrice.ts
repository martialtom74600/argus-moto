/** Résultat structuré du pipeline marché (Apify / cache). */
export type LivePriceResult = {
  price: number;
  confidence: number;
  /** Annonces retenues après filtre titre (prix exploitables). */
  sourcesFound: number;
  /** Moins de 3 sources concordantes → estimation à double-check. */
  needsReview: boolean;
};
