import { CERTIFIED_ARGUS_MIN_SIMILARITY } from "@/config/business";
import { getServiceSupabase } from "@/lib/db/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchInternalCrawlerPrice,
  isExternalMarketDisabled,
} from "@/lib/pricing/internal-crawler";
import { generateCanonicalSlug } from "@/lib/pricing/matcher";
import {
  adjustRetailForEstimateDetails,
  type EstimateDetailInput,
} from "@/lib/pricing/estimateDetails";
import {
  computeResidualReferenceEur,
  computeRetailNetOffer,
} from "@/lib/pricing/retailMatrix";

/** Souveraineté catalogue : match trigram + fraîcheur 7 j. */
const MIN_INSTANT_SIMILARITY = 0.85;
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const MIN_SCORE_TO_UPDATE_ROW = 0.35;

function forceLivePricing(): boolean {
  return process.env.FORCE_LIVE_PRICING?.trim() === "true";
}

function isStale(updatedAt: string | null | undefined): boolean {
  if (!updatedAt) return true;
  const t = new Date(updatedAt).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t > STALE_AFTER_MS;
}

function normCatalogLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export type EstimateSuccessBody = {
  success: true;
  pricingSource: "catalog_instant" | "internal_crawler" | "argus_predictif";
  /** instant | rafraîchissement catalogue | acquisition hors match fort */
  orchestratorPath?: "instant" | "catalog_refresh" | "market_acquisition";
  match: {
    brand: string;
    model: string;
    retailPrice: number;
  };
  offer: number;
  /** Valeur résiduelle indicative (revente occasion typique), avant marge rachat. */
  estimatedResaleEur: number;
  confidenceScore?: number | null;
  confidence_score?: number | null;
  sourcesFound?: number | null;
  needsReview?: boolean;
  /** Match catalogue très fort (≥ seuil Argus). */
  certifiedArgusMoto?: boolean;
  retailerSource?: string | null;
  isOfficialFeed?: boolean;
};

export type EstimateFallbackBody = {
  success: false;
  message: string;
  fallback: true;
  /** Si vrai, l’API ne doit pas substituer un fallback Argus automatique. */
  skipSovereignOffer?: boolean;
};

type RpcRow = {
  id: string;
  brand: string;
  model: string;
  category: string;
  retail_price: number;
  image_url: string | null;
  similarity: number;
  updated_at: string;
};

function parseRpcRow(raw: unknown): RpcRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = o.id;
  const brand = o.brand;
  const model = o.model;
  const category = o.category;
  const retailPriceRaw = o.retail_price;
  const imageRaw = o.image_url;
  const similarityRaw = o.similarity;
  const updatedAt = o.updated_at;
  if (typeof id !== "string") return null;
  if (typeof brand !== "string") return null;
  if (typeof model !== "string") return null;
  if (typeof category !== "string") return null;
  const retailPrice =
    typeof retailPriceRaw === "number"
      ? retailPriceRaw
      : Number(retailPriceRaw);
  if (!Number.isFinite(retailPrice)) return null;
  let image_url: string | null = null;
  if (imageRaw == null) image_url = null;
  else if (typeof imageRaw === "string") image_url = imageRaw;
  else return null;
  const similarityNum =
    typeof similarityRaw === "number"
      ? similarityRaw
      : Number(similarityRaw);
  if (!Number.isFinite(similarityNum)) return null;
  if (typeof updatedAt !== "string") return null;
  return {
    id,
    brand,
    model,
    category,
    retail_price: retailPrice,
    image_url,
    similarity: similarityNum,
    updated_at: updatedAt,
  };
}

function parseRpcRows(data: unknown): RpcRow[] {
  if (!Array.isArray(data)) return [];
  const out: RpcRow[] = [];
  for (const item of data) {
    const row = parseRpcRow(item);
    if (row) out.push(row);
  }
  return out;
}

/** Best-effort : l’estimation ne doit jamais échouer si le RPC est absent ou refusé. */
async function incrementSearchCount(
  supabase: SupabaseClient,
  rowId: string
): Promise<void> {
  try {
    const { error } = await supabase.rpc("increment_product_search_count", {
      p_id: rowId,
    });
    if (error) {
      console.warn(
        "[estimate] increment_product_search_count (ignoré, flux inchangé):",
        error.message
      );
    }
  } catch (e) {
    console.warn(
      "[estimate] increment search_count (ignoré, flux inchangé):",
      e instanceof Error ? e.message : e
    );
  }
}

/** Payloads émis pendant l’exécution (flux NDJSON côté API). */
export type EstimateProgressPayload =
  | { phase: "catalog_lookup" }
  | {
      phase: "catalog_result";
      matched: boolean;
      similarity: number;
      stale: boolean;
      instant: boolean;
      forceLive: boolean;
      orchestratorPath?:
        | "instant"
        | "catalog_refresh"
        | "market_acquisition"
        | "live_pending";
    }
  | { phase: "market_sync_start"; searchQuery: string }
  | {
      phase: "market_sync_done";
      ok: boolean;
      medianEur: number | null;
      confidence?: number | null;
      needsReview?: boolean;
      retailerSource?: string;
    }
  | { phase: "persist_start" }
  | { phase: "persist_done"; ok: boolean }
  | { phase: "matrix" };

export type EstimateRunResult =
  | {
      ok: true;
      status: number;
      body: EstimateSuccessBody | EstimateFallbackBody;
    }
  | {
      ok: false;
      status: number;
      body: { success: false; message: string };
    };

type EmitFn = (p: EstimateProgressPayload) => void;

function mergeDetailReview(
  fromLive: boolean | undefined,
  fromDetails: boolean
): boolean {
  return Boolean(fromLive) || fromDetails;
}

async function orchestrateAfterCatalogMatch(
  supabase: SupabaseClient,
  row: RpcRow | null,
  similarity: number,
  crawlBrand: string,
  crawlModel: string,
  category: string,
  condition: string,
  declinaison: string | undefined,
  emit: EmitFn,
  details?: EstimateDetailInput
): Promise<EstimateRunResult> {
  const fl = forceLivePricing();
  const stale = row != null ? isStale(row.updated_at) : false;
  const strongMatch = row != null && similarity >= MIN_INSTANT_SIMILARITY;

  const useInstant = !fl && strongMatch && !stale;

  let orchestratorPath:
    | "instant"
    | "catalog_refresh"
    | "market_acquisition"
    | "live_pending" = "market_acquisition";
  if (useInstant) orchestratorPath = "instant";
  else if (!fl && strongMatch && stale) orchestratorPath = "catalog_refresh";
  else if (fl) orchestratorPath = "live_pending";

  emit({
    phase: "catalog_result",
    matched: row != null,
    similarity,
    stale,
    instant: useInstant,
    forceLive: fl,
    orchestratorPath,
  });

  if (row?.id) {
    await incrementSearchCount(supabase, row.id);
  }

  console.log(
    "[estimate] orchestrator matched=%s sim=%s stale=%s path=%s",
    row != null ? "yes" : "no",
    similarity.toFixed(3),
    row != null ? stale : "n/a",
    orchestratorPath
  );

  if (useInstant) {
    const retail = Number(row!.retail_price);
    if (!Number.isFinite(retail) || retail <= 0) {
      return {
        ok: true,
        status: 200,
        body: {
          success: false,
          message: "Référence nécessitant une expertise.",
          fallback: true,
        },
      };
    }
    emit({ phase: "matrix" });
    const { adjustedRetail, needsReview: detailReview } =
      adjustRetailForEstimateDetails(retail, row!.category, details);
    const offer = computeRetailNetOffer(
      adjustedRetail,
      row!.category,
      condition
    );
    const estimatedResaleEur = computeResidualReferenceEur(
      adjustedRetail,
      row!.category,
      condition
    );
    const certifiedArgusMoto = similarity >= CERTIFIED_ARGUS_MIN_SIMILARITY;
    return {
      ok: true,
      status: 200,
      body: {
        success: true,
        pricingSource: "catalog_instant",
        orchestratorPath: "instant",
        match: {
          brand: row!.brand,
          model: row!.model,
          retailPrice: retail,
        },
        offer,
        estimatedResaleEur,
        needsReview: detailReview,
        certifiedArgusMoto,
      },
    };
  }

  const liveQuery = [crawlBrand, crawlModel, declinaison?.trim(), category]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
  emit({ phase: "market_sync_start", searchQuery: liveQuery });
  console.log("[estimate] Pipeline marché (crawler interne)…");

  const live = await fetchInternalCrawlerPrice(
    crawlBrand,
    crawlModel,
    category,
    declinaison?.trim() || undefined
  );
  const ok =
    live != null && Number.isFinite(live.price) && live.price > 0;

  emit({
    phase: "market_sync_done",
    ok,
    medianEur: ok ? live!.price : null,
    confidence: ok ? live!.confidence : null,
    needsReview: ok ? live!.needsReview : undefined,
    retailerSource: ok ? live!.retailerSource : undefined,
  });

  if (!ok) {
    return {
      ok: true,
      status: 200,
      body: {
        success: false,
        message: isExternalMarketDisabled()
          ? "Mode mock actif : la synchro marché est simulée."
          : "Référence nécessitant une expertise.",
        fallback: true,
      },
    };
  }

  const livePrice = live!.price;
  const nowIso = new Date().toISOString();
  let displayBrand: string;
  let displayModel: string;

  const persistPath: "catalog_refresh" | "market_acquisition" =
    !fl && strongMatch && stale ? "catalog_refresh" : "market_acquisition";

  emit({ phase: "persist_start" });
  let persistOk = true;
  let historyTargetId: string | null = row?.id ?? null;

  if (row?.id && similarity >= MIN_SCORE_TO_UPDATE_ROW) {
    const { error: upErr } = await supabase
      .from("products")
      .update({
        aggregated_retail_eur: livePrice,
        updated_at: nowIso,
        confidence_score: live!.confidence,
        last_retailer_source: live!.retailerSource ?? null,
        last_official_feed: live!.isOfficialFeed ?? null,
      })
      .eq("id", row.id);
    if (upErr) {
      console.error("[estimate] update après live", upErr.message);
      persistOk = false;
    } else {
      console.log(
        "[estimate] Produit mis à jour id=%s retail=%s conf=%s",
        row.id,
        livePrice,
        live!.confidence
      );
    }
    displayBrand = row.brand;
    displayModel = row.model;
  } else {
    displayBrand = normCatalogLabel(crawlBrand);
    displayModel = normCatalogLabel(
      declinaison?.trim()
        ? `${crawlModel} ${declinaison}`.trim()
        : crawlModel
    );
    const canonicalSlug = generateCanonicalSlug(displayBrand, displayModel);
    const { data: upRow, error: upErr } = await supabase
      .from("products")
      .upsert(
        {
          canonical_slug: canonicalSlug,
          brand: displayBrand,
          model: displayModel,
          category,
          aggregated_retail_eur: livePrice,
          confidence_score: live!.confidence,
          last_retailer_source: live!.retailerSource ?? null,
          last_official_feed: live!.isOfficialFeed ?? null,
          is_accessory: false,
          updated_at: nowIso,
        },
        { onConflict: "canonical_slug" }
      )
      .select("id")
      .single();

    if (upErr) {
      console.error("[estimate] upsert produit après live", upErr.message);
      persistOk = false;
    } else {
      historyTargetId = upRow?.id ?? historyTargetId;
      console.log(
        "[estimate] Produit upsert %s / %s / %s → %s €",
        displayBrand,
        displayModel,
        category,
        livePrice
      );
      if (upRow?.id && row == null) {
        await incrementSearchCount(supabase, upRow.id);
      }
    }
  }

  if (historyTargetId) {
    await supabase.from("product_price_history").insert({
      product_id: historyTargetId,
      price: livePrice,
      observed_at: nowIso,
    });
  }

  emit({ phase: "persist_done", ok: persistOk });
  emit({ phase: "matrix" });
  const { adjustedRetail, needsReview: detailReview } =
    adjustRetailForEstimateDetails(livePrice, category, details);
  const offer = computeRetailNetOffer(adjustedRetail, category, condition);
  const estimatedResaleEur = computeResidualReferenceEur(
    adjustedRetail,
    category,
    condition
  );
  const certifiedArgusMoto =
    row != null && similarity >= CERTIFIED_ARGUS_MIN_SIMILARITY;
  return {
    ok: true,
    status: 200,
    body: {
      success: true,
      pricingSource: "internal_crawler",
      orchestratorPath: persistPath,
      match: {
        brand: displayBrand,
        model: displayModel,
        retailPrice: livePrice,
      },
      offer,
      estimatedResaleEur,
      confidenceScore: live!.confidence,
      confidence_score: live!.confidence,
      sourcesFound: live!.sourcesFound,
      needsReview: mergeDetailReview(live!.needsReview, detailReview),
      certifiedArgusMoto,
      retailerSource: live!.retailerSource,
      isOfficialFeed: live!.isOfficialFeed,
    },
  };
}

/**
 * Fiche catalogue connue : match par `canonical_slug` + catégorie (similarité = 1).
 */
export async function runEstimateBySlug(
  canonicalSlug: string,
  category: string,
  condition: string,
  declinaison: string | undefined,
  details: EstimateDetailInput | undefined,
  onProgress?: (p: EstimateProgressPayload) => void
): Promise<EstimateRunResult> {
  const emit: EmitFn = (p) => {
    onProgress?.(p);
  };

  try {
    if (
      category === "casque" &&
      details?.hadImpact === true
    ) {
      return {
        ok: true,
        status: 200,
        body: {
          success: false,
          message:
            "Un casque ayant subi un choc ne peut pas être estimé automatiquement. Notre équipe peut vous proposer une expertise.",
          fallback: true,
          skipSovereignOffer: true,
        },
      };
    }

    emit({ phase: "catalog_lookup" });
    const supabase = getServiceSupabase();
    const { data, error } = await supabase.rpc("match_product_by_slug", {
      p_slug: canonicalSlug,
      item_category: category,
    });

    if (error) {
      console.error("[estimate] match_product_by_slug", error.message);
      return {
        ok: false,
        status: 503,
        body: { success: false, message: "Service catalogue indisponible." },
      };
    }

    const rows = parseRpcRows(data ?? []);
    const row = rows[0];
    if (!row) {
      return {
        ok: true,
        status: 200,
        body: {
          success: false,
          message: "Référence absente du catalogue pour cette catégorie.",
          fallback: true,
        },
      };
    }

    return orchestrateAfterCatalogMatch(
      supabase,
      row,
      1,
      row.brand,
      row.model,
      category,
      condition,
      declinaison,
      emit,
      details
    );
  } catch (err) {
    console.error("[estimate] slug", err);
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("SUPABASE") || msg.includes("Supabase")) {
      return {
        ok: false,
        status: 503,
        body: {
          success: false,
          message:
            "Configuration catalogue manquante. Vérifiez les variables Supabase.",
        },
      };
    }
    return {
      ok: false,
      status: 500,
      body: { success: false, message: "Impossible de traiter la demande." },
    };
  }
}

/**
 * Orchestrateur : catalogue souverain (7 j, 0,85) → rafraîchissement crawler.
 */
export async function runEstimate(
  brand: string,
  model: string,
  category: string,
  condition: string,
  declinaison: string | undefined,
  details: EstimateDetailInput | undefined,
  onProgress?: (p: EstimateProgressPayload) => void
): Promise<EstimateRunResult> {
  const emit: EmitFn = (p) => {
    onProgress?.(p);
  };

  try {
    if (
      category === "casque" &&
      details?.hadImpact === true
    ) {
      return {
        ok: true,
        status: 200,
        body: {
          success: false,
          message:
            "Un casque ayant subi un choc ne peut pas être estimé automatiquement. Notre équipe peut vous proposer une expertise.",
          fallback: true,
          skipSovereignOffer: true,
        },
      };
    }

    const searchQuery = [brand, model, declinaison?.trim()]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    emit({ phase: "catalog_lookup" });

    const supabase = getServiceSupabase();
    const { data, error } = await supabase.rpc("match_product_item", {
      search_query: searchQuery,
      item_category: category,
    });

    if (error) {
      console.error("[estimate] match_product_item", error.message);
      return {
        ok: false,
        status: 503,
        body: { success: false, message: "Service catalogue indisponible." },
      };
    }

    const rows = parseRpcRows(data ?? []);
    const row = rows[0] ?? null;
    const similarity = row?.similarity ?? 0;

    return orchestrateAfterCatalogMatch(
      supabase,
      row,
      similarity,
      brand,
      model,
      category,
      condition,
      declinaison,
      emit,
      details
    );
  } catch (err) {
    console.error("[estimate]", err);
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("SUPABASE") || msg.includes("Supabase")) {
      return {
        ok: false,
        status: 503,
        body: {
          success: false,
          message:
            "Configuration catalogue manquante. Vérifiez les variables Supabase.",
        },
      };
    }
    return {
      ok: false,
      status: 500,
      body: { success: false, message: "Impossible de traiter la demande." },
    };
  }
}
