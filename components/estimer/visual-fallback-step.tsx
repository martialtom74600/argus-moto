"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  CheckCircle,
  CircleNotch,
  Cpu,
  WarningCircle,
} from "@phosphor-icons/react";
import { HelmetIcon } from "@/components/icons/category-icons";
import { useSerperImageSearch } from "@/lib/hooks/use-serper-image-search";
import { uiEquipmentToSerperCategory } from "@/lib/serper/partner-image-search";
import { checkProductConsistency } from "@/lib/pricing/product-consistency";
import { cn } from "@/lib/utils";
import {
  uiBodySm,
  uiBtnPrimaryBar,
  uiHeadingSection,
  uiInput,
  uiOverline,
} from "@/lib/ui/site-ui";

const spring = { type: "spring" as const, stiffness: 320, damping: 32 };

const NBSP = "\u00a0";

const isDevUi =
  typeof process !== "undefined" && process.env.NODE_ENV === "development";

export type VisualFallbackSubmitPayload = {
  prixNeufEur: number;
  pickedImageUrl: string | null;
  /** Cote marché moyenne (Serper) — borne le prix côté API. */
  serperMarketPriceEur: number | null;
  /** Titre du listing pour le visuel choisi (obsolescence). */
  pickedImageTitle: string;
};

export type VisualFallbackStepProps = {
  /** Famille d’équipement (formulaire) : Serper + CLIP alignés. */
  equipmentId: string;
  marque: string;
  modele: string;
  keyboardPad?: number;
  onCalculate: (payload: VisualFallbackSubmitPayload) => void;
  isSubmitting?: boolean;
  /** Année d’achat (cohérence vs URL archive). */
  purchaseYear?: number | null;
};

export function VisualFallbackStep({
  equipmentId,
  marque,
  modele,
  keyboardPad = 0,
  onCalculate,
  isSubmitting = false,
  purchaseYear = null,
}: VisualFallbackStepProps) {
  const query = `${marque.trim()} ${modele.trim()}`.trim();
  const serperCategory = uiEquipmentToSerperCategory(equipmentId);
  const {
    imageUrls,
    estimatedMarketPriceEur,
    imageGalleryMeta,
    isLoading,
    fault,
    emptyGallery,
    imageBroken,
    setImageBroken,
    debugLines,
  } = useSerperImageSearch(query, serperCategory);

  const [priceInput, setPriceInput] = React.useState("");
  const priceInputRef = React.useRef<HTMLInputElement>(null);
  /** Visuel choisi par l’utilisateur (réassurance, même si seul le prix part au calcul). */
  const [pickedUrl, setPickedUrl] = React.useState<string | null>(null);
  /** L’utilisateur préfère saisir le prix sans se fier aux visuels proposés. */
  const [skippedGallery, setSkippedGallery] = React.useState(false);

  /** Tuiles grille dont le chargement a échoué (ne pas masquer toute la grille). */
  const [deadGalleryUrls, setDeadGalleryUrls] = React.useState<string[]>([]);

  React.useEffect(() => {
    setDeadGalleryUrls([]);
  }, [imageUrls]);

  React.useEffect(() => {
    setSkippedGallery(false);
  }, [query]);

  const galleryUrls = imageUrls.filter((u) => !deadGalleryUrls.includes(u));
  const identifiedCount = imageUrls.length;

  React.useEffect(() => {
    setPickedUrl((prev) => {
      if (prev && galleryUrls.includes(prev)) return prev;
      return galleryUrls[0] ?? null;
    });
  }, [galleryUrls]);

  const parsedPrice = React.useMemo(() => {
    const raw = priceInput.trim().replace(/\s/g, "").replace(",", ".");
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n);
  }, [priceInput]);

  const visibleCount = galleryUrls.length;

  const consistencyPreview = React.useMemo(() => {
    if (purchaseYear == null || purchaseYear <= 2020) return null;
    const url = skippedGallery ? null : pickedUrl;
    if (!url?.trim()) return null;
    const r = checkProductConsistency(url, purchaseYear);
    if (!r.consistent && r.userMessage) return r.userMessage;
    return null;
  }, [purchaseYear, skippedGallery, pickedUrl]);

  const noVisualFallbackReason =
    fault.kind !== "none" ||
    emptyGallery ||
    visibleCount === 0 ||
    (visibleCount === 1 && imageBroken);

  const noVisualFallback =
    !isLoading && !skippedGallery && noVisualFallbackReason;

  const showCounter =
    !isLoading &&
    !skippedGallery &&
    identifiedCount > 0 &&
    !noVisualFallback;

  const showGallery =
    !isLoading &&
    !skippedGallery &&
    fault.kind === "none" &&
    !emptyGallery &&
    visibleCount > 0 &&
    !(visibleCount === 1 && imageBroken);

  const isFewResults = showGallery && visibleCount > 0 && visibleCount < 4;

  const singlePreviewBroken =
    !isLoading &&
    !skippedGallery &&
    fault.kind === "none" &&
    visibleCount === 1 &&
    imageBroken;

  const fallbackCopy = React.useMemo(() => {
    if (singlePreviewBroken) {
      return {
        title: "L’aperçu ne s’est pas chargé",
        body: "Le lien image a été bloqué ou est invalide. Indiquez le prix neuf pour terminer, ou réessayez plus tard.",
      };
    }
    switch (fault.kind) {
      case "network":
        return {
          title: "Impossible de joindre le serveur d’images",
          body: "Le navigateur n’a pas reçu de réponse (serveur arrêté, erreur au 1er chargement CLIP, ou onglet rechargé pendant l’appel). Vérifiez le terminal Next, réessayez, ou utilisez le même hôte que dans la barre d’adresse (localhost ou 127.0.0.1). Vous pouvez saisir le prix neuf ci-dessous — l’estimation reste valable.",
        };
      case "config":
        return {
          title: "Recherche d’images non disponible ici",
          body: `${fault.message} Sur votre machine : ajoutez une clé valide dans .env.local puis redémarrez le serveur de développement.`,
        };
      case "bad_request":
        return {
          title: "Requête de recherche invalide",
          body: fault.message,
        };
      case "server":
        return {
          title: "Service d’images temporairement indisponible",
          body: `${fault.message} Réessayez dans quelques instants ou poursuivez avec le prix neuf.`,
        };
      case "no_match":
        return {
          title: "Aucune photo ne correspond assez à votre repère",
          body: `${fault.message} Vous pouvez saisir directement le prix d’achat neuf pour continuer — l’estimation reste valable.`,
        };
      case "none":
        if (emptyGallery || visibleCount === 0) {
          return {
            title: "Aucune photo proposée pour ce repère",
            body: "Les critères de nettoyage n’ont laissé aucun visuel exploitable. Indiquez le prix d’achat neuf pour poursuivre.",
          };
        }
        return {
          title: "Repère visuel indisponible",
          body: "Réessayez plus tard ou passez par le prix neuf ci-dessous.",
        };
    }
  }, [
    singlePreviewBroken,
    fault,
    emptyGallery,
    visibleCount,
  ]);

  const canSubmit = parsedPrice != null && !isSubmitting;

  const focusPriceField = React.useCallback(() => {
    requestAnimationFrame(() => {
      priceInputRef.current?.focus();
      priceInputRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, []);

  const onSkipGallery = () => {
    setSkippedGallery(true);
    setImageBroken(false);
    setPickedUrl(null);
    focusPriceField();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedPrice == null || isSubmitting) return;
    const url = skippedGallery ? null : pickedUrl;
    const title =
      url && imageGalleryMeta.length
        ? imageGalleryMeta.find((m) => m.url === url)?.title ?? ""
        : "";
    onCalculate({
      prixNeufEur: parsedPrice,
      pickedImageUrl: url,
      serperMarketPriceEur: estimatedMarketPriceEur,
      pickedImageTitle: title,
    });
  };

  const tileRing = (active: boolean) =>
    cn(
      "relative flex min-h-0 overflow-hidden transition-[box-shadow,ring,transform] duration-200",
      active
        ? "ring-2 ring-emerald-500 ring-offset-2 ring-offset-slate-100 shadow-md"
        : "ring-1 ring-slate-200/80 opacity-95 hover:opacity-100 hover:ring-slate-300"
    );

  /** Tuiles repère : une seule ligne, taille fixe (la bande s’élargit avec le nombre d’images). */
  const stripTileClass =
    "relative h-[7.25rem] w-[7.25rem] shrink-0 sm:h-[8.5rem] sm:w-[8.5rem]";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden min-w-0"
    >
      <div
        className="mx-auto flex w-full min-w-0 max-w-3xl flex-col px-5 pb-10 pt-2 sm:px-8"
        style={{
          paddingBottom: `max(2rem, env(safe-area-inset-bottom), ${keyboardPad}px)`,
        }}
      >
        <div className="mb-2 flex items-center justify-center gap-2 text-slate-500">
          <Cpu className="size-4 shrink-0 opacity-80" weight="duotone" aria-hidden />
          <span className={cn(uiOverline, "text-slate-500")}>
            Repère visuel
          </span>
        </div>

        <h2 className={cn(uiHeadingSection, "text-center")}>
          Quel visuel correspond à votre équipement ?
        </h2>
        <p
          className={cn(
            uiBodySm,
            "mx-auto mt-4 max-w-md text-center font-medium text-slate-600"
          )}
        >
          Touchez la photo qui ressemble le plus à votre modèle (elles sont
          filtrées pour éviter les doublons). Ensuite, indiquez son prix neuf.
        </p>

        {showCounter && (
          <p className="mx-auto mt-3 text-center text-[11px] font-medium tabular-nums tracking-wide text-slate-400">
            {identifiedCount} proposition
            {identifiedCount > 1 ? "s" : ""} distincte
            {identifiedCount > 1 ? "s" : ""} — repérées sur le Web
          </p>
        )}

        {showGallery && isFewResults ? (
          <p className="mx-auto mt-4 max-w-lg text-center text-[11px] font-medium leading-snug text-slate-600 sm:text-xs">
            Peu de résultats après filtrage — voici les plus probables.
          </p>
        ) : null}

        <div className="relative mx-auto mt-4 w-full min-w-0 max-w-full">
          <div
            className={cn(
              "relative w-full min-w-0 overflow-hidden rounded-3xl",
              "border border-slate-200/90 bg-slate-100 shadow-md ring-1 ring-slate-900/[0.04]",
              showGallery && visibleCount === 1 && "aspect-[4/3] max-h-[min(52vh,400px)]",
              showGallery && visibleCount > 1 && "mx-auto w-max max-w-full",
              !showGallery && "aspect-[4/3] min-h-[200px]"
            )}
          >
            {skippedGallery ? (
              <div className="flex size-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-50 via-white to-slate-100 px-6 py-8">
                <p className="text-center text-sm font-medium text-slate-600">
                  Pas d’illustration retenue
                </p>
                <p className="text-center text-xs leading-relaxed text-slate-500">
                  Indiquez le prix d’achat neuf ci-dessous pour poursuivre.
                </p>
              </div>
            ) : isLoading ? (
              <div
                className="flex size-full flex-col items-center justify-center gap-4 bg-gradient-to-br from-slate-100 via-white to-slate-100 px-5 py-8"
                aria-busy="true"
                aria-live="polite"
                aria-label="Recherche de visuels en cours"
              >
                <div
                  className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-emerald-100/20 to-transparent"
                  style={{
                    backgroundSize: "200% 100%",
                    animationDuration: "1.6s",
                  }}
                  aria-hidden
                />
                <CircleNotch
                  className="relative z-[1] size-12 animate-spin text-emerald-600/85 sm:size-14"
                  weight="bold"
                  aria-hidden
                />
                <div className="relative z-[1] flex flex-col items-center gap-2 text-center">
                  <span className="text-sm font-semibold text-slate-700 sm:text-base">
                    Recherche en cours…
                  </span>
                  <span className="max-w-[260px] text-[11px] font-medium leading-relaxed text-slate-500 sm:max-w-xs sm:text-xs">
                    Interrogation du Web, puis filtrage des photos (doublons,
                    cadrage). Cela peut prendre quelques secondes.
                  </span>
                  {query ? (
                    <span className="mt-1 rounded-full bg-white/90 px-3 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200/90 sm:text-[11px]">
                      «&nbsp;{query}&nbsp;»
                    </span>
                  ) : null}
                </div>
              </div>
            ) : showGallery ? (
              visibleCount === 1 ? (
                <div className="relative flex size-full min-h-0 items-center justify-center bg-white/40 p-3 sm:p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={galleryUrls[0]}
                    alt={`Visuel proposé pour ${query}`}
                    className="max-h-full max-w-full object-contain object-center mix-blend-multiply"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={() => setImageBroken(true)}
                  />
                  <div className="pointer-events-none absolute bottom-3 left-1/2 flex max-w-[90%] -translate-x-1/2 items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-emerald-800 shadow-sm ring-1 ring-emerald-600/25 sm:bottom-4 sm:text-[11px]">
                    <CheckCircle className="size-3.5 shrink-0" weight="fill" aria-hidden />
                    Proposition retenue
                  </div>
                </div>
              ) : (
                <div
                  className="max-w-full overflow-x-auto overscroll-x-contain [scrollbar-gutter:stable]"
                  role="list"
                  style={{ WebkitOverflowScrolling: "touch" }}
                >
                  <div className="mx-auto flex w-max min-w-full flex-nowrap justify-center gap-3 px-3 py-3 sm:gap-4 sm:px-4 sm:py-4">
                  {galleryUrls.map((src, i) => (
                    <button
                      key={`${src}-${i}`}
                      type="button"
                      onClick={() => setPickedUrl(src)}
                      className={cn(
                        stripTileClass,
                        tileRing(pickedUrl === src),
                        "rounded-2xl bg-white/90 p-0 text-left shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                      )}
                      aria-label={`Proposition visuelle ${i + 1} sur ${visibleCount}`}
                      aria-pressed={pickedUrl === src}
                    >
                      <span className="flex size-full min-h-0 items-center justify-center p-2 sm:p-2.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt=""
                          className="max-h-full max-w-full object-contain object-center mix-blend-multiply"
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setDeadGalleryUrls((prev) =>
                              prev.includes(src) ? prev : [...prev, src]
                            )
                          }
                        />
                      </span>
                      {pickedUrl === src ? (
                        <span className="absolute right-1.5 top-1.5 z-[1] flex size-6 items-center justify-center rounded-full bg-emerald-500 text-white shadow sm:right-2 sm:top-2 sm:size-7">
                          <CheckCircle className="size-4 sm:size-[1.1rem]" weight="fill" aria-hidden />
                        </span>
                      ) : null}
                    </button>
                  ))}
                  </div>
                </div>
              )
            ) : noVisualFallback ? (
              <div className="flex size-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-100 via-slate-50 to-slate-100 px-6 py-8">
                <HelmetIcon
                  className="size-20 text-slate-400 sm:size-24"
                  aria-hidden
                />
                <WarningCircle
                  className="size-8 text-amber-500/90"
                  weight="duotone"
                  aria-hidden
                />
                <p className="text-center text-sm font-semibold text-slate-700">
                  {fallbackCopy.title}
                </p>
                <p className="text-center text-xs font-medium leading-relaxed text-slate-600">
                  {fallbackCopy.body}
                </p>
                <button
                  type="button"
                  onClick={focusPriceField}
                  className="mt-1 rounded-full border border-emerald-600/40 bg-white px-4 py-2 text-xs font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-50/90"
                >
                  Saisir le prix neuf
                </button>
              </div>
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-100 via-slate-50 to-slate-100 px-6">
                <HelmetIcon
                  className="size-20 text-slate-400 sm:size-24"
                  aria-hidden
                />
                <p className="text-center text-xs font-medium text-slate-500">
                  Pas d’aperçu — poursuivez avec le prix neuf.
                </p>
              </div>
            )}
          </div>
          <p className="mt-3 text-center text-[10px] font-medium uppercase tracking-widest text-slate-400">
            Aperçu indicatif — à valider par vous
          </p>

          {showGallery && !skippedGallery && visibleCount > 1 ? (
            <p className="mt-2 text-center text-[11px] font-medium text-slate-500">
              Pastille sur la photo choisie — vous pouvez en changer à tout moment.
            </p>
          ) : null}

          {showGallery && !skippedGallery && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={onSkipGallery}
                className="text-center text-[12px] font-semibold text-slate-500 underline decoration-slate-300 underline-offset-4 transition hover:text-slate-800 hover:decoration-slate-500"
              >
                Aucun de ceux-là — saisir sans photo
              </button>
            </div>
          )}
        </div>

        {isDevUi && debugLines.length > 0 && (
          <details className="group mx-auto mt-6 w-full max-w-sm rounded-2xl border border-slate-200 bg-white/90 shadow-sm ring-1 ring-slate-900/[0.03]">
            <summary className="cursor-pointer list-none px-4 py-3 text-center text-xs font-semibold text-slate-600 marker:content-none [&::-webkit-details-marker]:hidden">
              <span className="border-b border-slate-300/90 pb-0.5 group-open:border-emerald-600/50">
                Journal technique (dev)
              </span>
            </summary>
            <pre className="mx-2 mb-3 max-h-48 overflow-auto rounded-xl bg-slate-50 p-3 text-left text-[10px] leading-relaxed text-slate-600 ring-1 ring-slate-200/80">
              {debugLines.join("\n")}
            </pre>
          </details>
        )}

        <form
          onSubmit={submit}
          className="mx-auto mt-8 w-full max-w-sm space-y-5"
        >
          {consistencyPreview ? (
            <p
              className="rounded-2xl border border-amber-200/90 bg-amber-50/95 px-4 py-3 text-center text-xs font-medium leading-relaxed text-amber-950 shadow-sm"
              role="alert"
            >
              {consistencyPreview}{" "}
              <span className="mt-1 block text-[11px] font-normal text-amber-900/85">
                Votre dossier pourra être marqué « à vérifier manuellement » après
                envoi.
              </span>
            </p>
          ) : null}

          <div className="rounded-3xl border border-slate-200/90 bg-white/90 p-5 shadow-sm ring-1 ring-slate-900/[0.03]">
            <label
              htmlFor="vf-declared-retail"
              className="block text-sm font-semibold leading-snug text-slate-800"
            >
              Quel était son prix d’achat neuf environ ?
            </label>
            <input
              ref={priceInputRef}
              id="vf-declared-retail"
              type="number"
              inputMode="decimal"
              min={1}
              step={1}
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              placeholder={`ex: 250${NBSP}€`}
              className={cn(
                uiInput,
                "mt-3 w-full py-3.5 pl-4 pr-4 text-base tabular-nums"
              )}
              autoComplete="off"
            />
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              Cette base sert à l’Argus Express et à l’indication de rachat.
            </p>
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className={cn(
              uiBtnPrimaryBar,
              "w-full py-4 text-[16px] shadow-md sm:text-[17px]",
              "disabled:pointer-events-none disabled:opacity-40"
            )}
          >
            {isSubmitting ? "Calcul en cours…" : "Calculer mon offre Cash"}
          </button>
        </form>
      </div>
    </motion.div>
  );
}
