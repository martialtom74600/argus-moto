import { getServiceSupabase } from "@/lib/db/supabase";

export type MarqueeCatalogProduct = {
  id: string;
  brand: string;
  model: string;
  imageUrl: string;
  /** Prix neuf / médiane marché ; `null` si absent (affichage rachat adapté). */
  retailBasisEur: number | null;
};

type RpcRow = {
  id: string;
  brand: string;
  model: string;
  image_url: string;
  retail_basis_eur: number | string | null;
};

type ProductRow = {
  id: string;
  brand: string;
  model: string;
  image_url: string;
  aggregated_retail_eur: number | string | null;
};

function parseRetail(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function mapRow(row: RpcRow): MarqueeCatalogProduct | null {
  if (
    !row.id ||
    typeof row.brand !== "string" ||
    typeof row.model !== "string" ||
    typeof row.image_url !== "string" ||
    !row.image_url.trim()
  ) {
    return null;
  }
  return {
    id: row.id,
    brand: row.brand,
    model: row.model,
    imageUrl: row.image_url.trim(),
    retailBasisEur: parseRetail(row.retail_basis_eur),
  };
}

/**
 * 20 fiches avec `image_url` renseignée, tirage aléatoire (`ORDER BY random()` via RPC).
 * Repli : échantillon mélangé côté Node si la RPC n’est pas déployée.
 */
export async function fetchMarqueeCatalogProducts(): Promise<MarqueeCatalogProduct[]> {
  const supabase = getServiceSupabase();

  const rpc = await supabase.rpc("random_catalog_products_for_marquee", {
    p_limit: 20,
  });

  if (!rpc.error && rpc.data && Array.isArray(rpc.data) && rpc.data.length > 0) {
    const list = (rpc.data as RpcRow[])
      .map(mapRow)
      .filter((p): p is MarqueeCatalogProduct => p != null);
    if (list.length > 0) return list;
  }

  const fb = await supabase
    .from("products")
    .select("id, brand, model, image_url, aggregated_retail_eur")
    .not("image_url", "is", null)
    .limit(400);

  if (fb.error || !fb.data?.length) {
    return [];
  }

  const withImage = (fb.data as ProductRow[]).filter(
    (r) => typeof r.image_url === "string" && r.image_url.trim().length > 0
  );
  const rows = [...withImage].sort(() => Math.random() - 0.5).slice(0, 20);
  return rows
    .map((r) =>
      mapRow({
        id: r.id,
        brand: r.brand,
        model: r.model,
        image_url: r.image_url,
        retail_basis_eur: r.aggregated_retail_eur,
      })
    )
    .filter((p): p is MarqueeCatalogProduct => p != null);
}
