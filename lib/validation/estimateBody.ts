import { z } from "zod";

const categoryEnum = z.enum([
  "casque",
  "blouson",
  "gants",
  "bottes",
  "pantalon",
]);
const conditionEnum = z.enum([
  "neuf-etiquette",
  "tres-bon",
  "bon",
  "etat-moyen",
]);

export const helmetAgeBandSchema = z.enum(["under-2", "2-to-5", "over-5"]);
export const completenessSchema = z.enum([
  "complete",
  "no-box",
  "accessories-missing",
]);
export type HelmetAgeBand = z.infer<typeof helmetAgeBandSchema>;
export type CompletenessId = z.infer<typeof completenessSchema>;

const declinaisonField = z.preprocess((val) => {
  if (val == null || val === "") return undefined;
  const t = String(val).trim().slice(0, 120);
  return t.length > 0 ? t : undefined;
}, z.string().max(120).optional());

const detailFields = {
  helmetAgeBand: helmetAgeBandSchema.optional(),
  hadImpact: z.boolean().optional(),
  equipmentSize: z
    .string()
    .max(24)
    .optional()
    .transform((s) => (s?.trim() ? s.trim() : undefined)),
  completeness: completenessSchema.optional(),
};

const estimateRequestBase = z
  .object({
    category: categoryEnum,
    condition: conditionEnum,
    /** Année d’achat (âge = année courante − cette valeur). */
    purchaseYear: z
      .number({ error: "Indiquez l’année d’achat." })
      .int({ error: "Indiquez l’année d’achat." }),
    declinaison: declinaisonField,
    canonical_slug: z
      .string()
      .max(280)
      .optional()
      .transform((s) => (s?.trim() ? s.trim() : undefined)),
    brand: z
      .string()
      .max(120)
      .optional()
      .transform((s) => s?.trim() ?? ""),
    model: z
      .string()
      .max(120)
      .optional()
      .transform((s) => s?.trim() ?? ""),
    /** Prix neuf déclaré (reprise hors catalogue / fallback visuel). */
    manualRetailEur: z
      .number()
      .positive()
      .transform((n) => Math.round(n))
      .optional(),
    /**
     * Saisie hors fiche catalogue : court-circuite le moteur et ouvre tout de suite
     * l’étape recherche visuelle + prix neuf (sans `canonical_slug`).
     */
    forceVisualFallback: z.boolean().optional(),
    /** Visuel choisi à l’étape galerie (URL image) — informations uniquement côté offre. */
    pickedUrl: z.preprocess(
      (val) => {
        if (val == null || val === "") return undefined;
        const t = String(val).trim();
        return t.length > 0 ? t : undefined;
      },
      z.string().url().max(2048).optional()
    ),
    /** Cote moyenne extraite des résultats Serper (proxy images) — borne le prix déclaré. */
    serperMarketPriceEur: z
      .number()
      .positive()
      .transform((n) => Math.round(n))
      .optional(),
    /** Titre listing du visuel choisi (obsolescence). */
    pickedImageTitle: z
      .string()
      .max(500)
      .optional()
      .transform((s) => (s?.trim() ? s.trim().slice(0, 500) : undefined)),
    /** Obligatoire si catégorie casque — certification coques / chutes. */
    physicalIntegrityCertified: z.boolean().optional(),
    ...detailFields,
  })
  .superRefine((val, ctx) => {
    const refY = new Date().getFullYear();
    if (val.purchaseYear < 1990 || val.purchaseYear > refY) {
      ctx.addIssue({
        code: "custom",
        message: `Année d’achat entre 1990 et ${refY}.`,
        path: ["purchaseYear"],
      });
    }
    if (val.canonical_slug && val.manualRetailEur != null) {
      ctx.addIssue({
        code: "custom",
        message:
          "Le prix neuf déclaré ne s’applique pas au parcours catalogue.",
        path: ["manualRetailEur"],
      });
    }
    if (val.canonical_slug && val.forceVisualFallback === true) {
      ctx.addIssue({
        code: "custom",
        message:
          "Le forçage visuel ne s’applique pas lorsqu’une fiche catalogue est sélectionnée.",
        path: ["forceVisualFallback"],
      });
    }
    if (val.canonical_slug && val.pickedUrl) {
      ctx.addIssue({
        code: "custom",
        message:
          "Le visuel sélectionné ne s’applique pas au parcours catalogue.",
        path: ["pickedUrl"],
      });
    }
    if (val.canonical_slug) {
      /* catalogue : mêmes contraintes détails */
    } else {
      if (!val.brand) {
        ctx.addIssue({
          code: "custom",
          message: "Marque requise (ou sélectionnez un produit du catalogue).",
          path: ["brand"],
        });
      }
      if (!val.model) {
        ctx.addIssue({
          code: "custom",
          message: "Modèle requis (ou sélectionnez un produit du catalogue).",
          path: ["model"],
        });
      }
    }

    if (val.category === "casque") {
      if (!val.helmetAgeBand) {
        ctx.addIssue({
          code: "custom",
          message: "Précisez l’âge du casque.",
          path: ["helmetAgeBand"],
        });
      }
      if (val.hadImpact !== true && val.hadImpact !== false) {
        ctx.addIssue({
          code: "custom",
          message: "Indiquez si le casque a subi un choc ou une chute.",
          path: ["hadImpact"],
        });
      }
      if (val.physicalIntegrityCertified !== true) {
        ctx.addIssue({
          code: "custom",
          message:
            "Cochez la certification sur l’intégrité du casque et l’origine des coques.",
          path: ["physicalIntegrityCertified"],
        });
      }
    }

    if (val.category === "gants" || val.category === "bottes") {
      if (!val.equipmentSize?.trim()) {
        ctx.addIssue({
          code: "custom",
          message: "La taille est requise pour cette catégorie.",
          path: ["equipmentSize"],
        });
      }
    }

  });

export type EstimateDetailsPayload = {
  helmetAgeBand?: z.infer<typeof helmetAgeBandSchema>;
  hadImpact?: boolean;
  equipmentSize?: string;
  completeness: z.infer<typeof completenessSchema>;
  visibleDefects: boolean;
};

function normalizeDetails(val: z.infer<typeof estimateRequestBase>): EstimateDetailsPayload {
  return {
    helmetAgeBand: val.helmetAgeBand,
    hadImpact: val.hadImpact,
    equipmentSize: val.equipmentSize,
    completeness: val.completeness ?? "complete",
    /** Déduit de l’état « Moyen » pour éviter de redemander la même chose. */
    visibleDefects: val.condition === "etat-moyen",
  };
}

export const estimateRequestSchema = estimateRequestBase.transform(
  (val): EstimateRequestValidated => {
    const details = normalizeDetails(val);
    const physicalOk =
      val.category === "casque"
        ? val.physicalIntegrityCertified === true
        : true;

    if (val.canonical_slug) {
      return {
        mode: "catalog",
        canonical_slug: val.canonical_slug,
        category: val.category,
        condition: val.condition,
        purchaseYear: val.purchaseYear,
        declinaison: val.declinaison,
        details,
        physicalIntegrityCertified: physicalOk,
      };
    }
    return {
      mode: "manual",
      brand: val.brand,
      model: val.model,
      category: val.category,
      condition: val.condition,
      purchaseYear: val.purchaseYear,
      declinaison: val.declinaison,
      details,
      physicalIntegrityCertified: physicalOk,
      ...(val.manualRetailEur != null
        ? { manualRetailEur: Math.round(val.manualRetailEur) }
        : {}),
      ...(val.forceVisualFallback === true
        ? { forceVisualFallback: true as const }
        : {}),
      ...(val.pickedUrl ? { pickedUrl: val.pickedUrl } : {}),
      ...(val.serperMarketPriceEur != null
        ? { serperMarketPriceEur: Math.round(val.serperMarketPriceEur) }
        : {}),
      ...(val.pickedImageTitle
        ? { pickedImageTitle: val.pickedImageTitle }
        : {}),
    };
  }
);

export type EstimateRequestValidated =
  | {
      mode: "catalog";
      canonical_slug: string;
      category: z.infer<typeof categoryEnum>;
      condition: z.infer<typeof conditionEnum>;
      purchaseYear: number;
      declinaison?: string;
      details: EstimateDetailsPayload;
      physicalIntegrityCertified: boolean;
    }
  | {
      mode: "manual";
      brand: string;
      model: string;
      category: z.infer<typeof categoryEnum>;
      condition: z.infer<typeof conditionEnum>;
      purchaseYear: number;
      declinaison?: string;
      details: EstimateDetailsPayload;
      physicalIntegrityCertified: boolean;
      manualRetailEur?: number;
      forceVisualFallback?: boolean;
      /** URL du visuel retenu par l’utilisateur (parcours hors catalogue). */
      pickedUrl?: string;
      serperMarketPriceEur?: number;
      pickedImageTitle?: string;
    };
