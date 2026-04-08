"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  CreditCard,
  Lightning,
  Shield,
  Truck,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  uiBodySm,
  uiHeadingSection,
  uiOverline,
} from "@/lib/ui/site-ui";

const spring = {
  type: "spring" as const,
  stiffness: 320,
  damping: 32,
  mass: 0.9,
};

export type MarketRange = {
  lowEur: number;
  highEur: number;
};

export type ResultTooOldScreenProps = {
  keyboardPad: number;
  categoryDisplayPlural: string;
  maxAgeYears: number;
  onRestartEstimate: () => void;
  aside: React.ReactNode;
};

/**
 * Produit au-delà du plafond d’âge : pas de montant, message sécurité + piste recyclage.
 */
export function ResultTooOldScreen({
  keyboardPad,
  categoryDisplayPlural,
  maxAgeYears,
  onRestartEstimate,
  aside,
}: ResultTooOldScreenProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden"
    >
      <div
        className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-10 px-5 pb-8 pt-6 sm:gap-12 sm:pb-10 sm:pt-8 lg:grid-cols-12 lg:items-start lg:gap-14"
        style={{
          paddingBottom: `max(2rem, env(safe-area-inset-bottom), ${keyboardPad}px)`,
        }}
      >
        <div className="flex flex-col lg:col-span-7">
          <div className="flex flex-col gap-2 text-center lg:max-w-xl lg:text-left">
            <p className={cn(uiOverline, "text-slate-500")}>Analyse terminée</p>
            <h2 className={cn(uiHeadingSection)}>
              Rachat non disponible pour cet équipement
            </h2>
          </div>

          <div className="mt-8 flex flex-col items-center lg:items-start">
            <div className="max-w-xl rounded-3xl border border-amber-200/90 bg-amber-50/90 px-5 py-6 text-center shadow-sm sm:px-7 sm:py-8 lg:text-left">
              <p className="text-base font-semibold leading-relaxed text-amber-950 sm:text-lg">
                Pour garantir la sécurité des motards, nous ne rachetons pas les{" "}
                <span className="whitespace-nowrap">{categoryDisplayPlural}</span>{" "}
                de plus de {maxAgeYears}
                {NBSP}ans.
              </p>
              <p className={cn("mt-5 text-sm leading-relaxed text-amber-950/90 sm:text-[15px]")}>
                Voulez-vous le déposer en magasin pour un recyclage
                éco-responsable (bon d&apos;achat de 5{NBSP}€ offert) ?
              </p>
              <a
                href="mailto:contact@re-ride.fr?subject=Recyclage%20%C3%A9quipement%20moto"
                className={cn(
                  "mt-6 inline-flex w-full items-center justify-center rounded-3xl border border-amber-300/80",
                  "bg-white px-5 py-3.5 text-center text-sm font-semibold text-amber-950 shadow-sm",
                  "transition hover:bg-amber-100/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60",
                  "no-underline sm:text-base"
                )}
              >
                Écrire-nous pour le dépôt recyclage
              </a>
            </div>
          </div>

          <button
            type="button"
            onClick={onRestartEstimate}
            className="mx-auto mt-10 block max-w-xl text-sm font-semibold tracking-wide text-slate-500 underline decoration-slate-300/80 underline-offset-4 transition hover:text-emerald-800 hover:decoration-emerald-400/80 lg:mx-0"
          >
            Recommencer une estimation
          </button>
        </div>

        {aside}
      </div>
    </motion.div>
  );
}

export type ResultScreenProps = {
  keyboardPad: number;
  /** Fourchette marché : bas = rachat express, haut = vente par vos soins indicative. */
  marketRange: MarketRange | null;
  certifiedArgusMoto?: boolean;
  annoncesMention: string;
  retailFmt: string;
  isOfficialFeed?: boolean;
  retailerSource?: string;
  sourcesFound?: number;
  pricingSource: "catalog_instant" | "internal_crawler" | "argus_predictif";
  /** Alerte métier (ex. plafonnement prix déclaré sur la cote marché). */
  marketPricingNote?: string;
  /** Année déclarée vs URL « archive » (vérificateur de cohérence). */
  consistencyWarning?: string;
  /** Dossier marqué pour contrôle manuel. */
  needsManualVerification?: boolean;
  /** Casque : clause offre / micro-fissures CE. */
  helmetOfferDisclaimer?: boolean;
  needsReview?: boolean;
  confidenceScore?: number;
  onArgusExpress: () => void;
  onPreferSellMyself: () => void;
  onRestartEstimate: () => void;
  aside: React.ReactNode;
  hidden?: boolean;
};

function formatEurCompact(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 0,
  }).format(value);
}

const NBSP = "\u00a0";

export function ResultScreen({
  keyboardPad,
  marketRange,
  certifiedArgusMoto,
  annoncesMention,
  retailFmt,
  isOfficialFeed,
  retailerSource,
  sourcesFound,
  pricingSource,
  marketPricingNote,
  consistencyWarning,
  needsManualVerification,
  helmetOfferDisclaimer,
  needsReview,
  confidenceScore,
  onArgusExpress,
  onPreferSellMyself,
  onRestartEstimate,
  aside,
  hidden = false,
}: ResultScreenProps) {
  const hasRange =
    marketRange != null &&
    marketRange.lowEur > 0 &&
    marketRange.highEur >= marketRange.lowEur;

  const lowFmt = hasRange ? formatEurCompact(marketRange.lowEur) : "";
  const highFmt = hasRange ? formatEurCompact(marketRange.highEur) : "";

  const reassurance = [
    {
      Icon: CreditCard,
      label: "Paiement sécurisé",
    },
    {
      Icon: Truck,
      label: "Étiquette d’envoi fournie",
    },
    {
      Icon: Shield,
      label: "Zéro frais cachés",
    },
  ] as const;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{
        opacity: hidden ? 0.5 : 1,
        y: 0,
        filter: hidden ? "blur(2px)" : "blur(0px)",
      }}
      transition={spring}
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden",
        hidden && "pointer-events-none select-none"
      )}
      aria-hidden={hidden}
    >
      <div
        className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-10 px-5 pb-8 pt-6 sm:gap-12 sm:pb-10 sm:pt-8 lg:grid-cols-12 lg:items-start lg:gap-14"
        style={{
          paddingBottom: `max(2rem, env(safe-area-inset-bottom), ${keyboardPad}px)`,
        }}
      >
        <div className="flex flex-col lg:col-span-7">
          <div className="flex flex-col gap-2 text-center lg:max-w-xl lg:text-left">
            <p className={cn(uiOverline, "text-slate-500")}>Analyse terminée</p>
            <h2 className={cn(uiHeadingSection)}>Valeur estimée sur le marché</h2>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
            {certifiedArgusMoto && (
              <span
                className={cn(
                  "rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em]",
                  "border border-emerald-200/90 bg-gradient-to-r from-emerald-50 to-amber-50/80 text-emerald-900 shadow-sm"
                )}
              >
                Certifié Argus
              </span>
            )}
          </div>

          <div className="mt-6 flex flex-col items-center lg:items-start">
            {hasRange ? (
              <>
                <p
                  className="text-center text-3xl font-bold leading-snug tracking-tight text-slate-900 tabular-nums sm:text-4xl sm:leading-tight lg:text-left lg:text-[2.75rem] lg:leading-[1.1]"
                  aria-label={`Entre ${lowFmt} euros et ${highFmt} euros`}
                >
                  Entre{" "}
                  <span className="text-emerald-700">
                    {lowFmt}
                    {NBSP}€
                  </span>
                  {" et "}
                  <span className="text-slate-800">
                    {highFmt}
                    {NBSP}€
                  </span>
                </p>
                <p
                  className={cn(
                    uiBodySm,
                    "mt-4 max-w-md text-center font-medium text-slate-600 lg:text-left"
                  )}
                >
                  Cette estimation prend en compte l&apos;état, la marque et les
                  tendances actuelles du marché.
                </p>
                <p className="mt-3 max-w-md text-center text-sm font-medium leading-relaxed text-slate-500 lg:text-left">
                  {annoncesMention}
                </p>
              </>
            ) : (
              <div className="max-w-md rounded-3xl border border-slate-200/90 bg-slate-50/80 px-5 py-6 text-center lg:text-left">
                <p className="text-xl font-bold tracking-tight text-slate-800">
                  Fourchette à confirmer
                </p>
                <p className={cn("mt-2", uiBodySm)}>
                  Nous affinons la fourchette avec vous avant toute offre de
                  rachat.
                </p>
                <p className="mt-3 text-xs text-slate-500">{annoncesMention}</p>
              </div>
            )}
          </div>

          <p className="mx-auto mt-6 max-w-md text-center text-sm leading-relaxed text-slate-500 lg:mx-0 lg:text-left">
            Prix neuf catalogue (référence) :{" "}
            <span className="font-medium text-slate-700">{retailFmt}</span>
          </p>

          {marketPricingNote ? (
            <p
              className={cn(
                "mx-auto mt-4 max-w-md rounded-3xl border border-sky-200/90 bg-sky-50/90 px-4 py-3 text-center text-xs font-medium leading-relaxed text-sky-950 shadow-sm lg:mx-0 lg:text-left"
              )}
              role="status"
            >
              {marketPricingNote}
            </p>
          ) : null}

          <div className="mx-auto mt-6 flex w-full max-w-md flex-col gap-2.5 lg:mx-0">
            {isOfficialFeed && (
              <p
                className={cn(
                  "rounded-3xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-xs leading-relaxed tracking-wide text-slate-800 shadow-sm"
                )}
              >
                Cote {retailerSource ?? "Data Lake"} ·{" "}
                {Math.max(1, sourcesFound ?? 1)} sources
              </p>
            )}
            {pricingSource === "argus_predictif" && (
              <p
                className={cn(
                  "rounded-3xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-xs tracking-wide text-slate-800 shadow-sm"
                )}
              >
                Projection sans marché temps réel — fourchette indicative
              </p>
            )}
            {needsManualVerification ? (
              <p
                className="rounded-3xl border border-violet-200/90 bg-violet-50/90 px-4 py-3 text-xs font-medium leading-relaxed tracking-wide text-violet-950 shadow-sm"
                role="status"
              >
                <span className="block font-semibold uppercase tracking-wide text-[10px] text-violet-900/90">
                  À vérifier manuellement
                </span>
                <span className="mt-1 block">
                  {consistencyWarning ??
                    "Incohérence détectée entre le visuel et les informations déclarées."}
                </span>
              </p>
            ) : consistencyWarning ? (
              <p
                className="rounded-3xl border border-amber-200/90 bg-amber-50/90 px-4 py-3 text-xs font-medium tracking-wide text-amber-950 shadow-sm"
                role="alert"
              >
                {consistencyWarning}
              </p>
            ) : null}
            {needsReview && (
              <p className="rounded-3xl border border-amber-200/90 bg-amber-50/90 px-4 py-3 text-xs tracking-wide text-amber-950 shadow-sm">
                Transmission à valider
                {typeof confidenceScore === "number"
                  ? ` · ${Math.round(confidenceScore)} %`
                  : ""}
              </p>
            )}
            {typeof confidenceScore === "number" && confidenceScore < 70 && (
              <p
                className={cn(
                  "rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs tracking-wide text-slate-700 shadow-sm"
                )}
              >
                Peu de points de comparaison — relecture conseillée
              </p>
            )}
          </div>

          <div
            className={cn(
              "mx-auto mt-10 w-full max-w-md overflow-hidden rounded-3xl",
              "bg-gradient-to-br from-emerald-600 via-emerald-700 to-emerald-900",
              "p-6 shadow-xl shadow-emerald-900/25 ring-1 ring-emerald-950/20 sm:p-8 lg:mx-0"
            )}
          >
            <div className="flex items-start gap-3">
              <div
                className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white ring-1 ring-white/25"
                aria-hidden
              >
                <Lightning className="size-7" weight="duotone" />
              </div>
              <div className="min-w-0 text-left">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-100/95">
                  L&apos;Offre Argus Express
                </p>
                <p className="mt-2 text-[15px] font-medium leading-snug text-white sm:text-base">
                  Ne gérez pas les acheteurs, les négociations ou les litiges.
                  On vous l&apos;achète aujourd&apos;hui.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onArgusExpress}
              disabled={!hasRange}
              className={cn(
                "relative mt-7 w-full overflow-hidden rounded-3xl px-5 py-4 text-center text-[17px] font-bold tracking-tight",
                "bg-white text-emerald-950 shadow-lg shadow-emerald-950/20",
                "ring-2 ring-white/80 transition-[transform,box-shadow,background-color] duration-200",
                "hover:bg-emerald-50 hover:shadow-xl hover:shadow-emerald-950/25",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-800",
                "active:scale-[0.99] disabled:pointer-events-none disabled:opacity-45 sm:py-[1.15rem] sm:text-lg"
              )}
            >
              <span className="relative z-[1] inline-flex items-center justify-center gap-2">
                <Shield className="size-6 shrink-0 text-emerald-700" weight="duotone" aria-hidden />
                {hasRange ? (
                  <>
                    Recevoir {lowFmt}
                    {NBSP}€ immédiatement
                  </>
                ) : (
                  <>Recevoir une offre ferme</>
                )}
              </span>
            </button>

            <ul
              className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-4 sm:gap-y-3"
              aria-label="Garanties"
            >
              {reassurance.map(({ Icon, label }) => (
                <li
                  key={label}
                  className="flex items-center gap-2 rounded-2xl bg-white/10 px-3 py-2 text-left text-[12px] font-semibold text-emerald-50 ring-1 ring-white/15 sm:text-[13px]"
                >
                  <Icon className="size-5 shrink-0 text-emerald-100" weight="duotone" aria-hidden />
                  {label}
                </li>
              ))}
            </ul>
          </div>

          <button
            type="button"
            onClick={onPreferSellMyself}
            className={cn(
              "mx-auto mt-8 max-w-md text-center text-[13px] font-medium leading-snug text-slate-500",
              "underline decoration-slate-300/90 underline-offset-[5px] transition",
              "hover:text-slate-800 hover:decoration-slate-500 lg:mx-0 lg:text-left"
            )}
          >
            {hasRange ? (
              <>
                Je préfère prendre le temps de le vendre moi-même à {highFmt}
                {NBSP}€.
              </>
            ) : (
              <>Je préfère vendre par moi-même et tenter le meilleur prix.</>
            )}
          </button>

          <button
            type="button"
            onClick={onRestartEstimate}
            className="mx-auto mt-5 block text-sm font-semibold tracking-wide text-slate-500 underline decoration-slate-300/80 underline-offset-4 transition hover:text-emerald-800 hover:decoration-emerald-400/80 lg:mx-0"
          >
            Recommencer une estimation
          </button>

          {helmetOfferDisclaimer ? (
            <p className="mx-auto mt-6 max-w-md text-center text-[11px] leading-relaxed text-slate-500 lg:mx-0 lg:text-left">
              Offre garantie sous réserve que l&apos;inspection physique confirme
              l&apos;absence de micro-fissures sur les coques (norme CE).
            </p>
          ) : null}
        </div>

        {aside}
      </div>
    </motion.div>
  );
}
