"use client";

import * as React from "react";
import Link from "next/link";
import { VisualFallbackStep } from "@/components/estimer/visual-fallback-step";

function useVisualViewportPad() {
  const [pad, setPad] = React.useState(0);
  React.useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setPad(hidden > 80 ? hidden - 48 : 0);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return pad;
}

export function DevVisualFallbackClient() {
  const keyboardPad = useVisualViewportPad();

  return (
    <div className="min-h-[100dvh] bg-[#FDFDFD]">
      <header className="border-b border-slate-200/80 px-5 py-4 sm:px-8">
        <Link
          href="/estimer"
          className="text-sm font-semibold text-emerald-800 underline-offset-4 hover:underline"
        >
          ← Retour à l&apos;estimateur
        </Link>
        <p className="mt-2 text-xs font-medium uppercase tracking-widest text-slate-400">
          Dev only — recherche image Google
        </p>
      </header>
      <VisualFallbackStep
        equipmentId="casque"
        marque="Shoei"
        modele="NXR2"
        keyboardPad={keyboardPad}
        onCalculate={(p) => {
          const vis =
            p.pickedImageUrl == null
              ? ""
              : `\nVisuel : ${p.pickedImageUrl.length > 72 ? `${p.pickedImageUrl.slice(0, 72)}…` : p.pickedImageUrl}`;
          const cote =
            p.serperMarketPriceEur != null
              ? `\nCote marché (Serper) : ${p.serperMarketPriceEur} €`
              : "";
          const titre =
            p.pickedImageTitle.trim().length > 0
              ? `\nTitre listing : ${p.pickedImageTitle.length > 80 ? `${p.pickedImageTitle.slice(0, 80)}…` : p.pickedImageTitle}`
              : "";
          window.alert(
            `Prix neuf simulé : ${p.prixNeufEur} €${vis}${cote}${titre}\n(aucun appel API /estimate ici).`
          );
        }}
      />
    </div>
  );
}
