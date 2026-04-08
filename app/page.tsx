import type { Metadata } from "next";
import { HomePageContent } from "@/components/site/home-page-content";
import { fetchMarqueeCatalogProducts } from "@/lib/data/fetch-marquee-catalog-products";

export const metadata: Metadata = {
  title:
    "Re-Ride | Conciergerie moto — estimez et transmettez votre équipement en confiance",
  description:
    "Estimation marché en quelques minutes. Mandat clair, diffusion maîtrisée, encaissement sécurisé entre passionnés. Commission transparente, aucun stock de notre côté.",
};

export default async function HomePage() {
  const products = await fetchMarqueeCatalogProducts();
  console.log("Fiches catalogue (marquee):", products.length);

  return <HomePageContent marqueeProducts={products} />;
}
