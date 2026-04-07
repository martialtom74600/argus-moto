import { createHash } from "node:crypto";
import { getServiceSupabase } from "@/lib/db/supabase";
import type { LivePriceResult } from "@/lib/pricing/livePrice";

function normLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function cacheTtlMs(): number {
  const raw = process.env.SHOPPING_CACHE_TTL_HOURS?.trim();
  const h = raw ? Number.parseInt(raw, 10) : NaN;
  const hours = Number.isFinite(h) && h > 0 ? Math.min(h, 168) : 48;
  return hours * 3600 * 1000;
}

export function shoppingMedianCacheKey(params: {
  brand: string;
  model: string;
  category: string;
  declinaison: string | undefined;
  actorId: string;
  limit: number;
}): string {
  const payload = JSON.stringify({
    b: normLabel(params.brand),
    m: normLabel(params.model),
    c: params.category.trim().toLowerCase(),
    d: params.declinaison ? normLabel(params.declinaison) : "",
    a: params.actorId.trim(),
    l: params.limit,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function inferFromSampleCount(sampleCount: number): Pick<
  LivePriceResult,
  "confidence" | "needsReview"
> {
  const needsReview = sampleCount < 3;
  let confidence = Math.min(100, Math.round(28 + sampleCount * 17));
  if (needsReview) confidence = Math.min(confidence, 52);
  return { confidence, needsReview };
}

export async function getCachedLivePrice(
  key: string
): Promise<LivePriceResult | null> {
  if (process.env.SHOPPING_MEDIAN_CACHE_DISABLED?.trim() === "true") {
    return null;
  }
  try {
    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from("shopping_median_cache")
      .select(
        "median_eur, fetched_at, sample_count, confidence_score, needs_review"
      )
      .eq("query_key", key)
      .maybeSingle();

    if (error || !data?.fetched_at) return null;

    const fetched = new Date(data.fetched_at).getTime();
    if (Number.isNaN(fetched) || Date.now() - fetched > cacheTtlMs()) {
      return null;
    }

    const price = Number(data.median_eur);
    if (!Number.isFinite(price) || price <= 0) return null;

    const n = Number(data.sample_count) || 0;
    let confidence =
      data.confidence_score != null ? Number(data.confidence_score) : NaN;
    let needsReview = data.needs_review;

    if (!Number.isFinite(confidence)) {
      const inf = inferFromSampleCount(n);
      confidence = inf.confidence;
      needsReview = inf.needsReview;
    }
    if (needsReview == null) {
      needsReview = n < 3;
    }

    return {
      price,
      confidence: Math.max(0, Math.min(100, Math.round(confidence))),
      sourcesFound: n,
      needsReview: Boolean(needsReview),
    };
  } catch {
    return null;
  }
}

export async function putCachedLivePrice(
  key: string,
  result: LivePriceResult
): Promise<void> {
  if (process.env.SHOPPING_MEDIAN_CACHE_DISABLED?.trim() === "true") {
    return;
  }
  if (!Number.isFinite(result.price) || result.price <= 0) return;
  try {
    const supabase = getServiceSupabase();
    const { error } = await supabase.from("shopping_median_cache").upsert(
      {
        query_key: key,
        median_eur: result.price,
        sample_count: result.sourcesFound,
        confidence_score: result.confidence,
        needs_review: result.needsReview,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "query_key" }
    );
    if (error) {
      console.warn("[shopping-cache] upsert:", error.message);
    }
  } catch (e) {
    console.warn("[shopping-cache]", e);
  }
}
