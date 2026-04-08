import { z } from "zod";

/** Montants catalogue / moteur : souvent des décimaux côté JSON — on arrondit en entier €. */
const eurRounded = z
  .number()
  .nonnegative()
  .transform((n) => Math.round(n));

export const sellerLeadMetadataSchema = z.object({
  brand: z.string().min(1),
  model: z.string().min(1),
  category: z.string().min(1),
  conditionLabel: z.string().min(1),
  catalogSlug: z.string().nullable().optional(),
  retailReferenceEur: eurRounded,
  completeness: z.string().optional(),
  equipmentSize: z.string().optional(),
  helmetAgeBand: z.string().optional(),
  hadImpact: z.boolean().nullable().optional(),
  declinaison: z.string().optional(),
  certifiedArgus: z.boolean().optional(),
  coteArgusEur: eurRounded.nullable().optional(),
  offerEngineEur: eurRounded,
  snapshot: z.record(z.string(), z.unknown()).optional(),
});

export type SellerLeadMetadata = z.infer<typeof sellerLeadMetadataSchema>;

export const sellerLeadBodySchema = z.object({
  firstName: z.string().min(1).max(120),
  email: z.string().email().max(320),
  phone: z.string().max(40).optional().nullable(),
  pilotStory: z.string().max(8000).optional().nullable(),
  metadata: sellerLeadMetadataSchema,
});

export type SellerLeadBody = z.infer<typeof sellerLeadBodySchema>;
