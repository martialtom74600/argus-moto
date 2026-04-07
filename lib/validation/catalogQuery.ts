import { z } from "zod";

export const catalogCategorySchema = z.enum([
  "casque",
  "blouson",
  "gants",
  "bottes",
  "pantalon",
]);
