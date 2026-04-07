"use client";

import * as React from "react";
import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { ImageBroken } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { MarqueeCatalogProduct } from "@/lib/data/fetch-marquee-catalog-products";

const BUYBACK_RATIO = 0.55;

function formatEur(n: number) {
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 0,
  }).format(n);
}

function loopDurationSec(uniqueCount: number) {
  return Math.max(52, Math.min(160, 40 + uniqueCount * 5));
}

function MarqueeCard({
  product,
  onPointerEnter,
  onPointerLeave,
}: {
  product: MarqueeCatalogProduct;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const [imgFailed, setImgFailed] = React.useState(false);
  const buybackPrice =
    product.retailBasisEur != null
      ? Math.round(BUYBACK_RATIO * product.retailBasisEur)
      : null;
  const label = `${product.brand} ${product.model}`.trim();

  return (
    <article
      className={cn(
        "pointer-events-auto w-[280px] shrink-0 select-none rounded-3xl border border-slate-200/90 bg-white p-4 shadow-sm"
      )}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div
        className={cn(
          "relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-50 ring-1 ring-slate-200/60"
        )}
      >
        {imgFailed ? (
          <div
            className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-4 text-center"
            aria-hidden
          >
            <ImageBroken
              className="size-10 text-slate-400"
              weight="duotone"
              aria-hidden
            />
            <span className="text-[11px] font-medium leading-snug text-slate-500">
              Visuel indisponible
            </span>
          </div>
        ) : (
          <Image
            src={product.imageUrl}
            alt={label || "Produit"}
            fill
            className="object-contain object-center p-3"
            sizes="280px"
            priority={false}
            onError={() => setImgFailed(true)}
          />
        )}
      </div>
      <div className="mt-3.5 space-y-1 px-0.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {product.brand}
        </p>
        <p className="line-clamp-2 min-h-[2.5rem] text-[15px] font-semibold leading-snug tracking-tight text-slate-900">
          {product.model}
        </p>
        {buybackPrice != null ? (
          <p className="pt-1 text-base font-bold tabular-nums tracking-tight text-emerald-600">
            Rachat immédiat : {formatEur(buybackPrice)} €
          </p>
        ) : (
          <p className="pt-1 text-base font-bold tracking-tight text-emerald-600">
            Rachat immédiat : estimez en ligne
          </p>
        )}
      </div>
    </article>
  );
}

export type LiveProductMarqueeProps = {
  products: MarqueeCatalogProduct[];
};

/**
 * Bandeau type e-commerce : boucle infine (piste dupliquée), animation linéaire.
 */
export function LiveProductMarquee({ products }: LiveProductMarqueeProps) {
  const prefersReducedMotion = useReducedMotion();
  const hoverDepth = React.useRef(0);
  const [paused, setPaused] = React.useState(false);
  const motionPaused = paused || !!prefersReducedMotion;

  const onCardEnter = React.useCallback(() => {
    hoverDepth.current += 1;
    setPaused(true);
  }, []);

  const onCardLeave = React.useCallback(() => {
    hoverDepth.current = Math.max(0, hoverDepth.current - 1);
    if (hoverDepth.current === 0) setPaused(false);
  }, []);

  const track = React.useMemo(() => [...products, ...products], [products]);
  const loopSec = loopDurationSec(Math.max(1, products.length));

  if (products.length === 0) {
    return (
      <div className="border-y border-slate-200/80 bg-slate-50/70 py-10">
        <p className="text-center text-sm text-slate-500">Chargement des offres…</p>
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden" aria-hidden={false}>
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-14 bg-gradient-to-r from-white via-white/90 to-transparent sm:w-20"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-14 bg-gradient-to-l from-white via-white/90 to-transparent sm:w-20"
        aria-hidden
      />
      <motion.div
        className="flex w-max gap-5 py-2 will-change-transform"
        animate={motionPaused ? false : { x: ["0%", "-50%"] }}
        transition={
          motionPaused
            ? { duration: 0 }
            : {
                duration: loopSec,
                repeat: Number.POSITIVE_INFINITY,
                ease: "linear",
                repeatType: "loop",
                repeatDelay: 0,
              }
        }
      >
        {track.map((product, i) => (
          <MarqueeCard
            key={`${product.id}-${i}`}
            product={product}
            onPointerEnter={onCardEnter}
            onPointerLeave={onCardLeave}
          />
        ))}
      </motion.div>
    </div>
  );
}
