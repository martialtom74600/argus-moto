import { EstimationForm } from "@/components/estimer/estimation-form";

/** Évite cache navigateur / CDN sur une route fortement évolutive (UI client). */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function EstimerPage() {
  return <EstimationForm />;
}
