import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/db/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = getServiceSupabase();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [{ count: totalProducts, error: totalErr }, { count: refreshed24h, error: refreshErr }, brandsRes] =
      await Promise.all([
        supabase
          .from("products")
          .select("id", { count: "exact", head: true }),
        supabase
          .from("retailer_prices")
          .select("id", { count: "exact", head: true })
          .gte("observed_at", since24h),
        supabase
          .from("products")
          .select("brand")
          .not("brand", "is", null),
      ]);

    if (totalErr || refreshErr || brandsRes.error) {
      return NextResponse.json(
        { success: false, message: "Impossible de calculer les stats admin." },
        { status: 500 }
      );
    }

    const freq = new Map<string, number>();
    for (const row of brandsRes.data ?? []) {
      const key = String(row.brand ?? "").trim();
      if (!key) continue;
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
    const topBrands = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([brand, count]) => ({ brand, count }));

    return NextResponse.json({
      success: true,
      totalProducts: totalProducts ?? 0,
      refreshedLast24h: refreshed24h ?? 0,
      topBrands,
    });
  } catch (err) {
    console.error("[admin/stats]", err);
    return NextResponse.json(
      { success: false, message: "Erreur serveur." },
      { status: 500 }
    );
  }
}
