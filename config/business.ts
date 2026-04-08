/**
 * Paramètres métier — modèle **recommerce** : tu rachètes pour revendre avec marge.
 *
 * 1) **Valeur résiduelle** (ordre de grandeur de ce que tu peux espérer en retirant une revente) :
 *    B = prix_neuf × α_cat × α_état
 * 2) **Prix d’achat proposé** : tu gardes une part de B pour le risque, le stock et la marge :
 *    offre = arrondi(B × (1 − marge)) − frais_fixes
 *
 * Ajuste les tableaux ci-dessous ; le reste du code s’appuie sur ces seuls exports.
 */

export type PricingCategory =
  | "casque"
  | "blouson"
  | "gants"
  | "bottes"
  | "pantalon";

/** Forfait transport, contrôle, reconditionnement — déduit du prix d’achat affiché. */
export const LOGISTICS_FIXED_EUR = 15;

/** Affichage « Prix certifié Argus Moto » si match catalogue ≥ ce seuil. */
export const CERTIFIED_ARGUS_MIN_SIMILARITY = 0.9;

/**
 * En dessous de ce score (ou aucun RPC), le produit est considéré **hors base
 * catalogue** (ex. SKU jamais ingérés du flux e-commerce). On n’essaie pas le
 * crawler marché : le client passe par la **recherche visuelle** + prix neuf déclaré.
 * Monter à ~0.55–0.65 si tu préfères tenter le marché sur les matchs « moyens ».
 */
export const MIN_CATALOG_TRUST_SIMILARITY = 0.5;

/**
 * α_cat : part moyenne de la valeur « neuf » avant de compter l’état
 * (liquidité, obsolescence, perception de l’occasion). Voir PLAN_PRICING §2.2.
 */
export const CATEGORY_RESIDUAL_FACTOR: Record<PricingCategory, number> = {
  casque: 0.62,
  blouson: 0.72,
  gants: 0.68,
  bottes: 0.7,
  pantalon: 0.7,
};

/**
 * α_état : multiplicateur sur la branche (neuf × α_cat).
 * Clés alignées sur l’API / formulaire.
 */
export const CONDITION_WEIGHT: Record<string, number> = {
  "neuf-etiquette": 1.0,
  "tres-bon": 0.85,
  bon: 0.7,
  "etat-moyen": 0.5,
  /** Listing / signaux texte « ancien modèle » — plus conservateur que « patine marquée ». */
  "ancien-modele": 0.45,
};

function helmetResellerMarginInternal(retailNeuf: number): number {
  if (retailNeuf < 100) return 0.42;
  if (retailNeuf < 300) {
    const t = (retailNeuf - 100) / 200;
    return 0.42 + t * (0.28 - 0.42);
  }
  if (retailNeuf < 600) {
    const t = (retailNeuf - 300) / 300;
    return 0.28 + t * (0.18 - 0.28);
  }
  return 0.18;
}

function otherCategoriesResellerMarginInternal(retailNeuf: number): number {
  if (retailNeuf < 120) return 0.4;
  if (retailNeuf < 350) return 0.32;
  if (retailNeuf < 700) return 0.24;
  return 0.2;
}

/** Marge (fraction de B) selon catégorie et niveau de prix neuf de référence. */
export function resellerMarginRateForRetail(
  retailNeuf: number,
  category: PricingCategory
): number {
  if (category === "casque") return helmetResellerMarginInternal(retailNeuf);
  return otherCategoriesResellerMarginInternal(retailNeuf);
}

/**
 * @deprecated Nom historique — c’est bien la **marge repriseur** sur B, pas une « commission plateforme ».
 * Utiliser `resellerMarginRateForRetail`.
 */
export function commissionRateForRetail(
  retailNeuf: number,
  category: PricingCategory
): number {
  return resellerMarginRateForRetail(retailNeuf, category);
}

/** @deprecated utiliser `resellerMarginRateForRetail(..., "casque")` */
export function helmetCommissionRate(retailNeuf: number): number {
  return helmetResellerMarginInternal(retailNeuf);
}

/** @deprecated — grille « hors casque » historique */
export function defaultCommissionRate(retailNeuf: number): number {
  return otherCategoriesResellerMarginInternal(retailNeuf);
}
