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
import { computeRetailNetOffer } from "@/lib/pricing/retailMatrix";
import { estimateRequestSchema } from "@/lib/validation/estimateBody";

/**
 * Doit couvrir l’appel Apify (attente run + dataset).
 * Vercel Hobby ~10 s : le live pricing peut time-out sans upgrade.
 * Vercel Pro : jusqu’à 300 s selon le plan.
 */
export const maxDuration = 300;

export const dynamic = "force-dynamic";

export type { EstimateSuccessBody, EstimateFallbackBody };

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
    confidenceScore: 62,
    confidence_score: 62,
    sourcesFound: 0,
    needsReview: true,
    certifiedArgusMoto: false,
    retailerSource: "Argus Predictif",
    isOfficialFeed: true,
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
      return NextResponse.json(
        {
          success: false,
          message: "Données invalides.",
          fieldErrors: flat.fieldErrors,
          formErrors: flat.formErrors,
        },
        { status: 400 }
      );
    }

    const bodyIn = parsed.data;
    const details = toDetailInput(bodyIn.details);

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
      if (!result.body.success && "fallback" in result.body && result.body.fallback) {
        if (
          "skipSovereignOffer" in result.body &&
          result.body.skipSovereignOffer === true
        ) {
          return NextResponse.json(result.body, { status: result.status });
        }
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
          if (!result.body.success && "fallback" in result.body && result.body.fallback) {
            if (
              "skipSovereignOffer" in result.body &&
              result.body.skipSovereignOffer === true
            ) {
              send({
                type: "result",
                status: result.status,
                body: result.body,
              });
              return;
            }
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
