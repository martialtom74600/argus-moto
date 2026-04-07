import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/db/supabase";
import { catalogCategorySchema } from "@/lib/validation/catalogQuery";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog/brands?category=casque
 */
export async function GET(request: Request) {
  const category = catalogCategorySchema.safeParse(
    new URL(request.url).searchParams.get("category")
  );
  if (!category.success) {
    return NextResponse.json(
      { error: "Paramètre category invalide." },
      { status: 400 }
    );
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc("get_distinct_brands", {
    category_name: category.data,
  });

  if (error) {
    console.error("[catalog/brands]", error.message);
    return NextResponse.json(
      { error: "Catalogue indisponible." },
      { status: 503 }
    );
  }

  const rows = (data ?? []) as { brand: string }[];
  const brands = rows
    .map((r) => r.brand)
    .filter((b): b is string => typeof b === "string" && b.length > 0);

  return NextResponse.json({ brands }, { status: 200 });
}
