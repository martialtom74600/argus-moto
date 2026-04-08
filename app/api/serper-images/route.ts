import { NextResponse } from "next/server";
import {
  buildSerperImageQuery,
  dedupeEligibleForVisionCandidates,
  prepareSerperVisionPipeline,
  type PartnerImageSearchJson,
  type SerperImagesApiResponse,
  SERPER_IMAGES_URL,
  SERPER_IMAGE_CANDIDATE_LIMIT,
  SERPER_VISION_INPUT_LIMIT,
  SERPER_VISION_OUTPUT_LIMIT,
} from "@/lib/serper/partner-image-search";
import {
  filterSerperImagesWithClip,
  type ClipPipelineDebug,
} from "@/lib/ai/vision-service";
import { getSerperServerConfig } from "@/lib/env/serper.server";
import { imageSearchParamsSchema } from "@/lib/validation/image-search-query";

export const dynamic = "force-dynamic";
/** CLIP / Transformers.js nécessite le runtime Node (pas Edge). */
export const runtime = "nodejs";
/** Premier appel CLIP peut lancer le téléchargement du modèle ; laisser de la marge. */
export const maxDuration = 120;

type SerperClipDebug = ClipPipelineDebug & {
  clipFailed?: boolean;
  clipErrorMessage?: string;
  usedTextOnlyFallback?: boolean;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parsedParams = imageSearchParamsSchema.safeParse({
      q: searchParams.get("q") ?? "",
      category: searchParams.get("category") || undefined,
    });

    if (!parsedParams.success) {
      const msg = parsedParams.error.issues[0]?.message ?? "Requête invalide.";
      return NextResponse.json(
        { ok: false, error: { message: msg, code: 400 } } satisfies PartnerImageSearchJson,
        { status: 400 }
      );
    }

    const { q, category } = parsedParams.data;
    const { apiKey } = getSerperServerConfig();

  if (!apiKey) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[serper-images] SERPER_API_KEY manquante");
    }
    return NextResponse.json(
      {
        ok: false,
        error: {
          message:
            "Configuration Serper absente. Définissez SERPER_API_KEY dans .env.local, puis redémarrez le serveur.",
          code: 503,
        },
      } satisfies PartnerImageSearchJson,
      { status: 503 }
    );
  }

  const serperQuery = buildSerperImageQuery(q, category);
  if (!serperQuery) {
    return NextResponse.json(
      {
        ok: false,
        error: { message: "Requête vide après normalisation.", code: 400 },
      } satisfies PartnerImageSearchJson,
      { status: 400 }
    );
  }

  const res = await fetch(SERPER_IMAGES_URL, {
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

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: { message: "Réponse Serper non JSON.", code: 502 },
      } satisfies PartnerImageSearchJson,
      { status: 502 }
    );
  }

  const data = body as SerperImagesApiResponse;
  const bodyTop = body as Record<string, unknown>;

  if (!res.ok) {
    const msg =
      (typeof bodyTop.message === "string" && bodyTop.message.trim()
        ? bodyTop.message.trim()
        : null) ??
      (typeof data.error?.message === "string" && data.error.message.trim()
        ? data.error.message.trim()
        : null) ??
      `Erreur Serper (HTTP ${res.status}).`;
    /** Ne pas renvoyer le HTTP Serper tel quel : un 400 upstream n’est pas une « requête invalide » côté client. */
    const upstream = res.status;
    const clientStatus =
      upstream === 429 || upstream === 401 || upstream === 403
        ? upstream
        : 502;
    const detail =
      upstream !== clientStatus ? `${msg} (réponse Serper HTTP ${upstream}).` : msg;
    return NextResponse.json(
      {
        ok: false,
        error: { message: detail, code: clientStatus },
      } satisfies PartnerImageSearchJson,
      { status: clientStatus }
    );
  }

  if (typeof data.error?.message === "string" && data.error.message.trim()) {
    return NextResponse.json(
      {
        ok: false,
        error: { message: data.error.message.trim(), code: 502 },
      } satisfies PartnerImageSearchJson,
      { status: 502 }
    );
  }

  const { eligible: eligibleRaw, estimatedMarketPriceEur } =
    prepareSerperVisionPipeline(
      data,
      q,
      SERPER_VISION_INPUT_LIMIT,
      category
    );
  const eligible = dedupeEligibleForVisionCandidates(eligibleRaw);
  if (eligible.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          message:
            "Aucune image ne correspond au modèle (titre + mots-clés) ou résultats insuffisants.",
          code: 404,
        },
      } satisfies PartnerImageSearchJson,
      { status: 404 }
    );
  }

  const titleByUrl = new Map(eligible.map((e) => [e.url, e.title]));
  const orderedUrls = eligible.map((e) => e.url);

  let imageUrls: string[] = [];
  let clipDebug: SerperClipDebug | undefined;
  const isDev = process.env.NODE_ENV === "development";

  try {
    const outcome = await filterSerperImagesWithClip(orderedUrls, {
      maxOut: SERPER_VISION_OUTPUT_LIMIT,
      equipmentCategory: category,
    });
    imageUrls = outcome.urls;
    if (isDev && outcome.debug) {
      clipDebug = { ...outcome.debug, usedTextOnlyFallback: false };
    }
  } catch (err) {
    if (isDev) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[serper-images] Filtre CLIP indisponible, repli texte seul :", err);
      clipDebug = {
        modelId: "Xenova/clip-vit-base-patch32",
        textPrompt: "motorcycle gear",
        equipmentCategory: category,
        closeUpMargin: 0,
        closeUpRelaxedForQuantity: false,
        rescuedFromCloseUpFilter: 0,
        modelColdLoadMs: 0,
        requestTotalMs: 0,
        inputUrlCount: orderedUrls.length,
        outputUrlCount: 0,
        thresholds: { minMotorcycleCosine: 0, dedupeCosineMin: 0, closeUpMargin: 0 },
        rejectedFetch: 0,
        rejectedProcessor: 0,
        rejectedVision: 0,
        rejectedMotorcycleScore: 0,
        rejectedGeometry: 0,
        rejectedCloseUpShot: 0,
        rejectedDuplicate: 0,
        clipFailed: true,
        clipErrorMessage: msg,
        usedTextOnlyFallback: true,
      };
    }
  }

  if (imageUrls.length === 0) {
    imageUrls = orderedUrls.slice(0, SERPER_VISION_OUTPUT_LIMIT);
    if (isDev) {
      if (clipDebug && !clipDebug.clipFailed) {
        clipDebug = { ...clipDebug, usedTextOnlyFallback: true };
      } else if (!clipDebug) {
        clipDebug = {
          modelId: "Xenova/clip-vit-base-patch32",
          textPrompt: "motorcycle gear",
          equipmentCategory: category,
          closeUpMargin: 0,
          closeUpRelaxedForQuantity: false,
          rescuedFromCloseUpFilter: 0,
          modelColdLoadMs: 0,
          requestTotalMs: 0,
          inputUrlCount: orderedUrls.length,
          outputUrlCount: 0,
          thresholds: { minMotorcycleCosine: 0, dedupeCosineMin: 0, closeUpMargin: 0 },
          rejectedFetch: 0,
          rejectedProcessor: 0,
          rejectedVision: 0,
          rejectedMotorcycleScore: 0,
          rejectedGeometry: 0,
          rejectedCloseUpShot: 0,
          rejectedDuplicate: 0,
          usedTextOnlyFallback: true,
        };
      }
    }
  }

    const imageGalleryMeta = imageUrls.map((url) => ({
      url,
      title: titleByUrl.get(url) ?? "",
    }));

    const payload: PartnerImageSearchJson = {
      ok: true,
      imageUrls,
      imageUrl: imageUrls[0] ?? "",
      estimatedMarketPriceEur,
      imageGalleryMeta,
      ...(isDev && clipDebug ? { clipDebug } : {}),
    };

    return NextResponse.json(payload);
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : "Erreur interne lors de la recherche d’images.";
    console.error("[serper-images]", err);
    return NextResponse.json(
      {
        ok: false,
        error: { message: msg, code: 500 },
      } satisfies PartnerImageSearchJson,
      { status: 500 }
    );
  }
}
