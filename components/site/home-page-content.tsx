"use client";

import type * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ChartLineUp,
  ShareNetwork,
  ShieldCheck,
} from "@phosphor-icons/react";
import {
  HelmetIcon,
  JacketIcon,
  GloveIcon,
  PantIcon,
  BootIcon,
} from "@/components/icons/category-icons";
import {
  uiBody,
  uiBodySm,
  uiHeadingCard,
  uiHeadingSection,
  uiLinkSubtle,
  uiOverline,
} from "@/lib/ui/site-ui";
import { LiveProductMarquee } from "@/components/home/live-product-marquee";
import type { MarqueeCatalogProduct } from "@/lib/data/fetch-marquee-catalog-products";
import { cn } from "@/lib/utils";

const categoryItems = [
  { id: "casque", label: "Casque", Icon: HelmetIcon },
  { id: "blouson", label: "Blouson", Icon: JacketIcon },
  { id: "pantalon", label: "Pantalon", Icon: PantIcon },
  { id: "gants", label: "Gants", Icon: GloveIcon },
  { id: "bottes", label: "Bottes", Icon: BootIcon },
] as const;

const howSteps = [
  {
    title: "1. Estimation au plus près du terrain",
    body: "Vous décrivez le matériel. Nous croisons catalogue, historique et marché pour une fourchette de transmission réaliste.",
    Icon: ChartLineUp,
  },
  {
    title: "2. Mandat signé, route ouverte",
    body: "Vous validez le mandat : nous structurons la diffusion et qualifions les sollicitations. Le sérieux d’un briefing, sans le bruit des plateformes.",
    Icon: ShareNetwork,
  },
  {
    title: "3. Expédition maîtrisée, fonds sécurisés",
    body: "L’encaissement est verrouillé avant envoi. Étiquette, suivi : vous expédiez quand l’accord est clair.",
    Icon: ShieldCheck,
  },
] as const;

const fadeUpViewport = {
  once: true,
  margin: "-72px" as const,
  amount: 0.25,
};

/** Constellation hero : 5 icônes métier, positions en % pour un rendu “éditorial”. */
const heroIconLayout = [
  {
    Icon: HelmetIcon,
    position:
      "left-1/2 top-[6%] -translate-x-1/2 sm:top-[8%]",
    iconClass: "size-[7.25rem] text-slate-800 sm:size-[8.25rem]",
    delay: 0,
    floatDuration: 5.2,
  },
  {
    Icon: JacketIcon,
    position: "right-[2%] top-[20%] sm:right-[6%] sm:top-[22%]",
    iconClass: "size-[5.25rem] text-emerald-800/90 sm:size-24",
    delay: 0.08,
    floatDuration: 4.6,
  },
  {
    Icon: GloveIcon,
    position: "bottom-[16%] left-[4%] sm:bottom-[18%] sm:left-[7%]",
    iconClass: "size-20 text-slate-700 sm:size-24",
    delay: 0.16,
    floatDuration: 4.9,
  },
  {
    Icon: PantIcon,
    position:
      "bottom-[6%] left-1/2 -translate-x-1/2 sm:bottom-[8%] sm:left-[40%] sm:translate-x-0",
    iconClass: "w-[4.25rem] text-slate-800 sm:w-[5rem]",
    delay: 0.24,
    floatDuration: 5.5,
  },
  {
    Icon: BootIcon,
    position: "right-[6%] bottom-[8%] sm:right-[10%]",
    iconClass: "size-[5.5rem] text-slate-800 sm:size-24",
    delay: 0.32,
    floatDuration: 4.4,
  },
] as const;

type HomePageContentProps = {
  marqueeProducts: MarqueeCatalogProduct[];
};

export function HomePageContent({ marqueeProducts }: HomePageContentProps) {
  return (
    <div className="flex flex-col">
      {/* ——— Hero ——— */}
      <section className="relative overflow-hidden border-b border-slate-200/60">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.42]"
          aria-hidden
          style={{
            background:
              "radial-gradient(ellipse 85% 60% at 100% 0%, rgba(16,185,129,0.11) 0%, transparent 55%), radial-gradient(ellipse 55% 50% at 0% 100%, rgba(15,23,42,0.06) 0%, transparent 52%), radial-gradient(ellipse 50% 40% at 50% 80%, rgba(16,185,129,0.05) 0%, transparent 45%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-6 py-16 sm:px-8 sm:py-20 md:py-24 lg:px-10 lg:py-28">
          <div className="flex flex-col gap-12 lg:gap-14">
            <motion.div
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
              className="w-full text-center lg:text-left"
            >
              <h1
                className={cn(
                  "w-full max-w-none text-balance font-extrabold text-slate-900",
                  "tracking-[-0.02em] sm:tracking-[-0.01em]",
                  "text-4xl leading-[1.22] sm:text-5xl sm:leading-[1.18]",
                  "md:text-6xl md:leading-[1.14] lg:text-7xl lg:leading-[1.12]",
                  "xl:text-[5.25rem] xl:leading-[1.1]"
                )}
              >
                Transmettez votre équipement. On s’occupe du reste.
              </h1>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.6,
                delay: 0.08,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="flex w-full flex-col items-center gap-10 text-center lg:max-w-3xl lg:items-start lg:text-left"
            >
              <p
                className={cn(
                  "max-w-2xl text-pretty text-lg font-medium leading-relaxed text-slate-600 sm:text-xl sm:leading-relaxed"
                )}
              >
                Conciergerie moto : estimation marché en quelques minutes,
                mandat clair, diffusion tenue et encaissement sécurisé —
                pensé pour les pilotes qui veulent la même rigueur qu’en
                atelier.
              </p>
              <div className="flex w-full flex-col items-center gap-4 lg:items-start">
                <motion.div
                  whileHover={{ y: -3 }}
                  transition={{ type: "spring", stiffness: 400, damping: 22 }}
                  className="w-full max-w-md"
                >
                  <Link
                    href="/estimer"
                    prefetch={false}
                    className={cn(
                      "inline-flex min-h-14 w-full items-center justify-center rounded-3xl bg-emerald-600 px-10",
                      "text-base font-semibold tracking-tight text-white shadow-lg sm:text-lg",
                      "transition-[background-color,box-shadow,transform] duration-200",
                      "hover:bg-emerald-700 hover:shadow-xl focus-visible:outline-none",
                      "focus-visible:ring-2 focus-visible:ring-emerald-500/45 focus-visible:ring-offset-2",
                      "active:scale-[0.98] no-underline hover:text-white"
                    )}
                  >
                    Estimer mon équipement
                  </Link>
                </motion.div>
                <Link href="#comment-ca-marche" className={uiLinkSubtle}>
                  Comment ça marche
                </Link>
              </div>
            </motion.div>

            <div
              className="relative w-full min-h-[300px] sm:min-h-[380px] lg:min-h-[420px]"
              aria-hidden
            >
              <div className="absolute inset-0 rounded-3xl border border-slate-200/50 bg-white/40 shadow-sm ring-1 ring-slate-200/30 backdrop-blur-[2px]" />
              <div className="relative min-h-[300px] w-full sm:min-h-[380px] lg:min-h-[420px]">
                {heroIconLayout.map(
                  ({ Icon, position, iconClass, delay, floatDuration }, i) => (
                    <motion.div
                      key={i}
                      className={cn("absolute", position)}
                      initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      transition={{
                        duration: 0.75,
                        delay: 0.2 + delay,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                    >
                      <motion.div
                        className="drop-shadow-[0_10px_28px_rgba(15,23,42,0.12)]"
                        animate={{ y: [0, -7, 0] }}
                        transition={{
                          duration: floatDuration,
                          repeat: Number.POSITIVE_INFINITY,
                          ease: "easeInOut",
                          delay: i * 0.12,
                        }}
                      >
                        <Icon className={iconClass} aria-hidden />
                      </motion.div>
                    </motion.div>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ——— Marquee ——— */}
      <div className="border-b border-slate-200/80 bg-white">
        <div className="mx-auto max-w-6xl px-6 pt-10 sm:px-8 sm:pt-12 lg:px-10">
          <p
            className={cn(
              uiOverline,
              "text-center text-[11px] text-slate-600 sm:text-xs"
            )}
          >
            Du matériel qui reprend la route avec d’autres passionnés.
          </p>
        </div>
        <div className="pb-6 pt-8 sm:pb-8 sm:pt-10">
          <LiveProductMarquee products={marqueeProducts} />
        </div>
      </div>

      <section
        className="border-y border-slate-200 bg-slate-50/90 py-16 sm:py-20"
        aria-labelledby="categories-heading"
      >
        <div className="mx-auto max-w-6xl px-6 sm:px-8 lg:px-10">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={fadeUpViewport}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="text-center"
          >
            <p id="categories-heading" className={cn(uiOverline)}>
              Ce que nous accompagnons
            </p>
          </motion.div>
          <motion.ul
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={fadeUpViewport}
            transition={{ duration: 0.5, delay: 0.08 }}
            className="mt-10 flex flex-wrap items-end justify-center gap-8 sm:mt-12 sm:gap-10 md:gap-12"
          >
            {categoryItems.map(({ id, label, Icon }, i) => (
              <li key={id} className="flex flex-col items-center gap-3">
                <motion.div
                  className={cn(
                    "flex size-24 items-center justify-center rounded-3xl border border-slate-200 bg-white shadow-sm backdrop-blur-sm sm:size-28",
                    "transition-shadow duration-300 hover:shadow-md"
                  )}
                  animate={{ y: [0, -5, 0] }}
                  transition={{
                    duration: 3.2,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "easeInOut",
                    delay: i * 0.22,
                  }}
                >
                  <Icon
                    className={cn(
                      "size-16 text-slate-700 sm:size-20",
                      id === "pantalon" && "w-[4.5rem] sm:w-[5.25rem]"
                    )}
                    aria-hidden
                  />
                </motion.div>
                <span className="text-sm font-semibold tracking-tight text-slate-600">
                  {label}
                </span>
              </li>
            ))}
          </motion.ul>
        </div>
      </section>

      <motion.section
        id="comment-ca-marche"
        initial={{ opacity: 0, y: 36 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={fadeUpViewport}
        transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
        className="bg-white py-16 sm:py-20 md:py-24"
        style={{ scrollMarginTop: "5.5rem" }}
        aria-labelledby="how-heading"
      >
        <div className="mx-auto max-w-6xl px-6 sm:px-8 lg:px-10">
          <h2 id="how-heading" className={cn("text-center", uiHeadingSection)}>
            Comment ça marche
          </h2>
          <p className={cn("mx-auto mt-4 max-w-lg text-center sm:text-lg", uiBody)}>
            Tiers de confiance entre passionnés : vous définissez l’estimation
            avec nous, nous orchestrons la transmission — règles et commission
            transparentes, sans stock ni frais cachés.
          </p>
          <div className="mt-12 grid gap-6 sm:grid-cols-3 sm:gap-6 lg:mt-14 lg:gap-8">
            {howSteps.map(({ title, body, Icon }, i) => (
              <motion.article
                key={title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={fadeUpViewport}
                transition={{
                  duration: 0.5,
                  delay: i * 0.1,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className={cn(
                  "rounded-3xl border border-slate-200 bg-white px-7 py-9 shadow-sm sm:px-8 sm:py-10"
                )}
              >
                <div className="flex justify-center">
                  <Icon
                    className="size-16 shrink-0 text-emerald-600"
                    weight="duotone"
                    aria-hidden
                  />
                </div>
                <h3 className={cn("mt-6 text-center", uiHeadingCard)}>{title}</h3>
                <p className={cn("mt-3 text-center sm:text-[15px]", uiBodySm)}>
                  {body}
                </p>
              </motion.article>
            ))}
          </div>
        </div>
      </motion.section>

      <footer className="border-t border-slate-200 bg-slate-50/80">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <p className="text-sm font-semibold text-slate-800">
            © {new Date().getFullYear()} Re-Ride
          </p>
          <a
            href="mailto:contact@re-ride.fr"
            className={cn(
              "text-sm font-semibold text-slate-900 underline decoration-slate-300 underline-offset-4 transition-colors duration-200 hover:text-emerald-800 hover:decoration-emerald-400/80"
            )}
          >
            contact@re-ride.fr
          </a>
        </div>
      </footer>
    </div>
  );
}
