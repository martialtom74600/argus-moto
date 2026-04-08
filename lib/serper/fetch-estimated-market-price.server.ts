/**
 * Récupération serveur de la cote moyenne (extraite des résultats images Serper).
 * Utilisé quand le client n’a pas envoyé `serperMarketPriceEur` mais qu’on doit
 * quand même borner le prix neuf déclaré.
 */

import { getSerperServerConfig } from "@/lib/env/serper.server";
import {
  buildSerperImageQuery,
  prepareSerperVisionPipeline,
  SERPER_IMAGES_URL,
  SERPER_IMAGE_CANDIDATE_LIMIT,
  SERPER_VISION_INPUT_LIMIT,
  type SerperImagesApiResponse,
  uiEquipmentToSerperCategory,
} from "@/lib/serper/partner-image-search";

/**
 * @param equipmentCategoryId ex. `casque`, `blouson` (clé formulaire).
 */
export async function fetchSerperEstimatedMarketPriceEur(
  brand: string,
  modelLine: string,
  equipmentCategoryId: string
): Promise<number | null> {
  const { apiKey } = getSerperServerConfig();
  if (!apiKey) return null;

  const userQuery = [brand.trim(), modelLine.trim()].filter(Boolean).join(" ").trim();
  if (!userQuery) return null;

  const category = uiEquipmentToSerperCategory(equipmentCategoryId);
  const serperQuery = buildSerperImageQuery(userQuery, category);
  if (!serperQuery) return null;

  let res: Response;
  try {
    res = await fetch(SERPER_IMAGES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({
        q: serperQuery,
        num: SERPER_IMAGE_CANDIDATE_LIMIT,
        hl: "fr",
        gl: "fr",
      }),
      cache: "no-store",
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return null;
  }

  const data = body as SerperImagesApiResponse;
  if (typeof data.error?.message === "string" && data.error.message.trim()) {
    return null;
  }

  const { estimatedMarketPriceEur } = prepareSerperVisionPipeline(
    data,
    userQuery,
    SERPER_VISION_INPUT_LIMIT,
    category
  );

  return estimatedMarketPriceEur;
}
