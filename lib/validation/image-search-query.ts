import { z } from "zod";

/** Requête proxy image : évite les abus de quota (longueur bornée). */
export const imageSearchQuerySchema = z
  .string()
  .trim()
  .min(1, "Requête vide.")
  .max(200, "Requête trop longue.");

/** Aligné sur les 5 familles d’équipement (suffixe Serper + CLIP + mots interdits). */
export const serperEquipmentCategorySchema = z.enum([
  "helmets",
  "jackets",
  "pants",
  "boots",
  "gloves",
]);

export type SerperEquipmentCategoryZ = z.infer<
  typeof serperEquipmentCategorySchema
>;

export const imageSearchParamsSchema = z.object({
  q: imageSearchQuerySchema,
  category: serperEquipmentCategorySchema
    .optional()
    .transform((v) => v ?? "helmets"),
});
