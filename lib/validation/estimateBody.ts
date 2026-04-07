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
    ...detailFields,
  })
  .superRefine((val, ctx) => {
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
    if (val.canonical_slug) {
      return {
        mode: "catalog",
        canonical_slug: val.canonical_slug,
        category: val.category,
        condition: val.condition,
        declinaison: val.declinaison,
        details,
      };
    }
    return {
      mode: "manual",
      brand: val.brand,
      model: val.model,
      category: val.category,
      condition: val.condition,
      declinaison: val.declinaison,
      details,
    };
  }
);

export type EstimateRequestValidated =
  | {
      mode: "catalog";
      canonical_slug: string;
      category: z.infer<typeof categoryEnum>;
      condition: z.infer<typeof conditionEnum>;
      declinaison?: string;
      details: EstimateDetailsPayload;
    }
  | {
      mode: "manual";
      brand: string;
      model: string;
      category: z.infer<typeof categoryEnum>;
      condition: z.infer<typeof conditionEnum>;
      declinaison?: string;
      details: EstimateDetailsPayload;
    };
