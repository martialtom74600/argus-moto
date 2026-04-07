import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/db/supabase";
import { catalogCategorySchema } from "@/lib/validation/catalogQuery";

export const dynamic = "force-dynamic";

export type CatalogModelRow = {
  id: string;
  model: string;
  canonical_slug: string;
  image_url: string | null;
};

/**
 * GET /api/catalog/models?category=casque&brand=Shoei
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const category = catalogCategorySchema.safeParse(url.searchParams.get("category"));
  const brandRaw = url.searchParams.get("brand")?.trim() ?? "";

  if (!category.success) {
    return NextResponse.json(
      { error: "Paramètre category invalide." },
      { status: 400 }
    );
  }
  if (!brandRaw) {
    return NextResponse.json(
      { error: "Paramètre brand requis." },
      { status: 400 }
    );
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc("get_models_by_brand", {
    brand_name: brandRaw,
    category_name: category.data,
  });

  if (error) {
    console.error("[catalog/models]", error.message);
    return NextResponse.json(
      { error: "Catalogue indisponible." },
      { status: 503 }
    );
  }

  const models = (data ?? []) as CatalogModelRow[];

  return NextResponse.json({ models }, { status: 200 });
}
