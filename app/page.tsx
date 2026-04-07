import type { Metadata } from "next";
import { HomePageContent } from "@/components/site/home-page-content";
import { fetchMarqueeCatalogProducts } from "@/lib/data/fetch-marquee-catalog-products";

export const metadata: Metadata = {
  title: "Re-Ride | L’Argus de l’équipement moto · estimez en 2 minutes",
  description:
    "L’Argus leader de l’équipement moto. Estimez et vendez vos articles en 2 minutes.",
};

export default async function HomePage() {
  const products = await fetchMarqueeCatalogProducts();
  console.log("Produits récupérés:", products.length);

  return <HomePageContent marqueeProducts={products} />;
}
