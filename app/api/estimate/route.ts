import { NextResponse } from "next/server";
import {
  runEstimate,
  runEstimateBySlug,
  type EstimateSuccessBody,
  type EstimateFallbackBody,
} from "@/lib/pricing/estimateRun";
import { computeArgusPredictivePrice } from "@/lib/pricing/argus";
import { adjustRetailForEstimateDetails } from "@/lib/pricing/estimateDetails";
import type { EstimateDetailInput } from "@/lib/pricing/estimateDetails";
import {
  computeResidualReferenceEur,
  computeRetailNetOffer,
} from "@/lib/pricing/retailMatrix";
import { estimateRequestSchema } from "@/lib/validation/estimateBody";
import type { EquipmentCategoryId } from "@/lib/business/rules";
import {
  evaluatePurchaseYearGate,
  validateUserPrice,
} from "@/lib/pricing/engine";
import { detectListingObsolescence } from "@/lib/serper/partner-image-search";
import {
  checkProductConsistency,
  urlLooksLikeArchiveListing,
} from "@/lib/pricing/product-consistency";
import { fetchSerperEstimatedMarketPriceEur } from "@/lib/serper/fetch-estimated-market-price.server";

/**
 * Doit couvrir l’appel Apify (attente run + dataset).
 * Vercel Hobby ~10 s : le live pricing peut time-out sans upgrade.
 * Vercel Pro : jusqu’à 300 s selon le plan.
 */
export const maxDuration = 300;

export const dynamic = "force-dynamic";

export type { EstimateSuccessBody, EstimateFallbackBody };

/** Renvoyer le corps tel quel : pas de substitution Argus souveraine côté serveur. */
function isClientHandledFallback(body: unknown): body is EstimateFallbackBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  if (b.success !== false || b.fallback !== true) return false;
  return (
    b.skipSovereignOffer === true || b.visualFallback === true
  );
}

function buildSovereignArgusFallback(
  input: {
    brand: string;
    model: string;
    category: string;
    condition: string;
  },
  details?: EstimateDetailInput
): EstimateSuccessBody {
  const defaultRetailByCategory: Record<string, number> = {
    casque: 350,
    blouson: 240,
    pantalon: 200,
    gants: 90,
    bottes: 180,
  };
  const originalRetail = defaultRetailByCategory[input.category] ?? 220;
  const theoreticalPrice = computeArgusPredictivePrice(
    originalRetail,
    input.model,
    input.brand
  );
  const retailPrice = Math.max(45, Math.round(theoreticalPrice));
  const { adjustedRetail } = adjustRetailForEstimateDetails(
    retailPrice,
    input.category,
    details
  );
  const offer = computeRetailNetOffer(
    adjustedRetail,
    input.category,
    input.condition
  );
  const estimatedResaleEur = computeResidualReferenceEur(
    adjustedRetail,
    input.category,
    input.condition
  );

  return {
    success: true,
    pricingSource: "argus_predictif",
    orchestratorPath: "market_acquisition",
    match: {
      brand: input.brand,
      model: input.model,
      retailPrice,
    },
    offer,
    estimatedResaleEur,
    confidenceScore: 62,
    confidence_score: 62,
    sourcesFound: 0,
    needsReview: true,
    certifiedArgusMoto: false,
    retailerSource: "Argus Predictif",
    isOfficialFeed: true,
  };
}

/** Offre à partir du prix neuf déclaré (fallback visuel / hors catalogue). */
function buildOfferFromDeclaredRetail(
  input: {
    brand: string;
    model: string;
    category: string;
    condition: string;
  },
  declaredRetailEur: number,
  details?: EstimateDetailInput
): EstimateSuccessBody {
  const retailPrice = Math.max(45, Math.round(declaredRetailEur));
  const { adjustedRetail } = adjustRetailForEstimateDetails(
    retailPrice,
    input.category,
    details
  );
  const offer = computeRetailNetOffer(
    adjustedRetail,
    input.category,
    input.condition
  );
  const estimatedResaleEur = computeResidualReferenceEur(
    adjustedRetail,
    input.category,
    input.condition
  );

  return {
    success: true,
    pricingSource: "argus_predictif",
    orchestratorPath: "declared_retail",
    match: {
      brand: input.brand,
      model: input.model,
      retailPrice,
    },
    offer,
    estimatedResaleEur,
    confidenceScore: 58,
    confidence_score: 58,
    sourcesFound: 0,
    needsReview: true,
    certifiedArgusMoto: false,
    retailerSource: "Re-Ride — prix neuf déclaré",
    isOfficialFeed: false,
  };
}

function toDetailInput(d: import("@/lib/validation/estimateBody").EstimateDetailsPayload): EstimateDetailInput {
  return {
    helmetAgeBand: d.helmetAgeBand,
    hadImpact: d.hadImpact,
    equipmentSize: d.equipmentSize,
    completeness: d.completeness,
    visibleDefects: d.visibleDefects,
  };
}

function wantsNdjsonStream(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("application/x-ndjson")) return true;
  if (request.headers.get("x-estimate-stream") === "1") return true;
  return false;
}

export type EstimateTooOldBody = {
  success: false;
  blocked: true;
  blockReason: "TOO_OLD";
  maxAgeYears: number;
  categoryDisplayPlural: string;
};

function respondTooOld(request: Request, body: EstimateTooOldBody): Response {
  if (!wantsNdjsonStream(request)) {
    return NextResponse.json(body, { status: 200 });
  }
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ type: "result", status: 200, body })}\n`
          )
        );
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  );
}

/**
 * POST /api/estimate
 * Body JSON : détails estimation (âge casque, choc, taille, complétude, défauts)
 * + { category, condition, declinaison?, canonical_slug? | brand+model }.
 *
 * Avec `Accept: application/x-ndjson` ou `X-Estimate-Stream: 1` :
 * corps en flux NDJSON — une ligne JSON par événement, dernière ligne `{"type":"result",...}`.
 */
export async function POST(request: Request) {
  try {
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "Corps de requête invalide." },
        { status: 400 }
      );
    }

    const parsed = estimateRequestSchema.safeParse(json);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      const message =
        flat.formErrors[0] ??
        Object.values(flat.fieldErrors).flat()[0] ??
        "Données invalides.";
      return NextResponse.json(
        {
          success: false,
          message,
          fieldErrors: flat.fieldErrors,
          formErrors: flat.formErrors,
        },
        { status: 400 }
      );
    }

    const bodyIn = parsed.data;
    const details = toDetailInput(bodyIn.details);

    const ageGate = evaluatePurchaseYearGate(
      bodyIn.category as EquipmentCategoryId,
      bodyIn.purchaseYear
    );
    if (!ageGate.ok) {
      return respondTooOld(request, {
        success: false,
        blocked: true,
        blockReason: "TOO_OLD",
        maxAgeYears: ageGate.maxAgeYears,
        categoryDisplayPlural: ageGate.categoryDisplayPlural,
      });
    }

    if (
      bodyIn.mode === "manual" &&
      bodyIn.manualRetailEur != null &&
      Number.isFinite(bodyIn.manualRetailEur)
    ) {
      const modelFull = [bodyIn.model, bodyIn.declinaison]
        .filter(Boolean)
        .join(" ")
        .trim();
      const picked =
        typeof bodyIn.pickedUrl === "string" ? bodyIn.pickedUrl.trim() : "";
      const listingForcedOld =
        picked.length > 0 &&
        detectListingObsolescence(bodyIn.pickedImageTitle ?? "", picked);
      const resolvedCondition = listingForcedOld
        ? "ancien-modele"
        : bodyIn.condition;

      const listingArchived =
        picked.length > 0 && urlLooksLikeArchiveListing(picked);

      const consistency =
        picked.length > 0
          ? checkProductConsistency(picked, bodyIn.purchaseYear)
          : { consistent: true as const, requiresManualReview: false as const };

      let serperReferenceEur: number | undefined = bodyIn.serperMarketPriceEur;
      if (
        serperReferenceEur == null ||
        !Number.isFinite(serperReferenceEur) ||
        serperReferenceEur <= 0
      ) {
        const fetched = await fetchSerperEstimatedMarketPriceEur(
          bodyIn.brand,
          modelFull,
          bodyIn.category
        );
        if (fetched != null && Number.isFinite(fetched) && fetched > 0) {
          serperReferenceEur = fetched;
        }
      }

      const pv = validateUserPrice(bodyIn.manualRetailEur, serperReferenceEur, {
        listingAppearsArchived: listingArchived,
      });

      const baseOffer = buildOfferFromDeclaredRetail(
        {
          brand: bodyIn.brand,
          model: modelFull,
          category: bodyIn.category,
          condition: resolvedCondition,
        },
        pv.effectiveRetailEur,
        details
      );

      const declaredBody = {
        ...baseOffer,
        ...(picked ? { pickedImageUrl: picked } : {}),
        ...(pv.priceAdjustedByMarket && pv.adjustMessage
          ? { marketPricingNote: pv.adjustMessage }
          : {}),
        ...(listingForcedOld ? { forcedCondition: "ancien-modele" as const } : {}),
        ...(consistency.requiresManualReview && consistency.userMessage
          ? {
              consistencyWarning: consistency.userMessage,
              needsManualVerification: true as const,
              needsReview: true,
            }
          : {}),
      };
      if (!wantsNdjsonStream(request)) {
        return NextResponse.json(declaredBody, { status: 200 });
      }
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify({
                type: "result",
                status: 200,
                body: declaredBody,
              })}\n`
            )
          );
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    /** Saisie libre sans fiche catalogue : recherche image + prix neuf (sauf blocages métier). */
    if (
      bodyIn.mode === "manual" &&
      bodyIn.manualRetailEur == null &&
      bodyIn.forceVisualFallback === true
    ) {
      if (
        bodyIn.category === "casque" &&
        bodyIn.details.hadImpact === true
      ) {
        const helmetBody = {
          success: false as const,
          fallback: true as const,
          skipSovereignOffer: true as const,
          message:
            "Un casque ayant subi un choc ne peut pas être estimé automatiquement. Notre équipe peut vous proposer une expertise.",
        };
        if (!wantsNdjsonStream(request)) {
          return NextResponse.json(helmetBody, { status: 200 });
        }
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `${JSON.stringify({
                    type: "result",
                    status: 200,
                    body: helmetBody,
                  })}\n`
                )
              );
              controller.close();
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/x-ndjson; charset=utf-8",
              "Cache-Control": "no-store",
            },
          }
        );
      }

      const visualDirectBody = {
        success: false as const,
        fallback: true as const,
        visualFallback: true as const,
        message:
          "Affinez l’estimation avec la recherche visuelle et votre prix neuf indicatif.",
      };
      if (!wantsNdjsonStream(request)) {
        return NextResponse.json(visualDirectBody, { status: 200 });
      }
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `${JSON.stringify({
                  type: "result",
                  status: 200,
                  body: visualDirectBody,
                })}\n`
              )
            );
            controller.close();
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const run = () => {
      if (bodyIn.mode === "catalog") {
        return runEstimateBySlug(
          bodyIn.canonical_slug,
          bodyIn.category,
          bodyIn.condition,
          bodyIn.declinaison,
          details
        );
      }
      return runEstimate(
        bodyIn.brand,
        bodyIn.model,
        bodyIn.category,
        bodyIn.condition,
        bodyIn.declinaison,
        details
      );
    };

    const argusInput = () => {
      if (bodyIn.mode === "catalog") {
        const slug = bodyIn.canonical_slug;
        const tail = slug.includes("-") ? slug.slice(slug.lastIndexOf("-") + 1) : slug;
        return {
          brand: "Catalogue",
          model: tail.length > 2 ? tail : slug,
          category: bodyIn.category,
          condition: bodyIn.condition,
        };
      }
      return {
        brand: bodyIn.brand,
        model: [bodyIn.model, bodyIn.declinaison].filter(Boolean).join(" ").trim(),
        category: bodyIn.category,
        condition: bodyIn.condition,
      };
    };

    if (!wantsNdjsonStream(request)) {
      const result = await run();
      if (isClientHandledFallback(result.body)) {
        return NextResponse.json(result.body, { status: result.status });
      }
      if (!result.body.success && "fallback" in result.body && result.body.fallback) {
        const sovereign = buildSovereignArgusFallback(argusInput(), details);
        return NextResponse.json(sovereign, { status: 200 });
      }
      return NextResponse.json(result.body, { status: result.status });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) => {
          controller.enqueue(
            encoder.encode(`${JSON.stringify(obj)}\n`)
          );
        };
        try {
          const result =
            bodyIn.mode === "catalog"
              ? await runEstimateBySlug(
                  bodyIn.canonical_slug,
                  bodyIn.category,
                  bodyIn.condition,
                  bodyIn.declinaison,
                  details,
                  (p) => send({ type: "progress", ...p })
                )
              : await runEstimate(
                  bodyIn.brand,
                  bodyIn.model,
                  bodyIn.category,
                  bodyIn.condition,
                  bodyIn.declinaison,
                  details,
                  (p) => send({ type: "progress", ...p })
                );
          if (isClientHandledFallback(result.body)) {
            send({
              type: "result",
              status: result.status,
              body: result.body,
            });
            return;
          }
          if (!result.body.success && "fallback" in result.body && result.body.fallback) {
            const sovereign = buildSovereignArgusFallback(argusInput(), details);
            send({
              type: "result",
              status: 200,
              body: sovereign,
            });
            return;
          }
          send({
            type: "result",
            status: result.status,
            body: result.body,
          });
        } catch (err) {
          console.error("[estimate] stream", err);
          send({
            type: "error",
            status: 500,
            message: "Impossible de traiter la demande.",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Requête invalide." },
      { status: 400 }
    );
  }
}
