import { notFound } from "next/navigation";
import { DevVisualFallbackClient } from "./dev-visual-fallback-client";

export default function DevVisualFallbackPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <DevVisualFallbackClient />;
}
