import type { Metadata } from "next";
import { HomePageContent } from "@/components/site/home-page-content";

export const metadata: Metadata = {
  title: "Re-Ride | L’Argus de l’équipement moto · estimez en 2 minutes",
  description:
    "L’Argus leader de l’équipement moto. Estimez et vendez vos articles en 2 minutes.",
};

export default function HomePage() {
  return <HomePageContent />;
}
