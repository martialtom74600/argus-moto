"use client";

import Link from "next/link";
import { motion } from "framer-motion";
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
  uiBtnPrimaryWide,
  uiCard,
  uiCardLift,
  uiHeadingCard,
  uiHeadingDisplay,
  uiHeadingSection,
  uiLinkSubtle,
  uiMotionHoverTap,
  uiOverline,
} from "@/lib/ui/site-ui";
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
    step: "1",
    title: "Estimez",
    body: "Sélectionnez votre équipement en quelques clics et recevez une offre alignée sur le marché.",
  },
  {
    step: "2",
    title: "Expédiez",
    body: "Emballez votre article : étiquette et mode d’envoi sécurisé vous sont indiqués.",
  },
  {
    step: "3",
    title: "Recevez votre paiement",
    body: "Après contrôle, le montant convenu vous est versé rapidement, sans surprise.",
  },
] as const;

const fadeUpViewport = {
  once: true,
  margin: "-72px" as const,
  amount: 0.25,
};

export function HomePageContent() {
  return (
    <div className="flex flex-col">
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          aria-hidden
          style={{
            background:
              "radial-gradient(ellipse 80% 55% at 100% 0%, rgba(16,185,129,0.09) 0%, transparent 55%), radial-gradient(ellipse 60% 45% at 0% 100%, rgba(15,23,42,0.04) 0%, transparent 50%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-6 py-16 sm:px-8 sm:py-20 md:py-28 lg:px-10">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.55,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="mx-auto max-w-3xl text-center"
          >
            <h1
              className={cn(
                "text-balance text-4xl sm:text-5xl sm:leading-[1.05] lg:text-6xl",
                uiHeadingDisplay
              )}
            >
              <span className="block">L’Argus leader de l’équipement moto.</span>
              <span className="mx-auto mt-5 block max-w-xl text-pretty text-xl font-bold leading-snug tracking-tight text-slate-600 sm:mt-6 sm:text-2xl sm:leading-snug lg:text-[1.65rem]">
                Estimez et vendez vos articles en 2 minutes.
              </span>
            </h1>
            <div className="mt-12 flex flex-col items-center gap-4 sm:mt-14">
              <motion.div {...uiMotionHoverTap}>
                <Link
                  href="/estimer"
                  prefetch={false}
                  className={cn(
                    uiBtnPrimaryWide,
                    "no-underline text-white hover:text-white"
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
        </div>
      </section>

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
            <p id="categories-heading" className={cn("text-xs tracking-[0.2em]", uiOverline)}>
              Équipements repris
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
                    "flex size-[4.5rem] items-center justify-center backdrop-blur-sm sm:size-[5rem]",
                    uiCard,
                    uiCardLift,
                    "bg-white/90"
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
                      "size-12 text-slate-700",
                      id === "pantalon" && "w-[3.25rem]"
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
        className="py-16 sm:py-20 md:py-24"
        style={{ scrollMarginTop: "5.5rem" }}
        aria-labelledby="how-heading"
      >
        <div className="mx-auto max-w-6xl px-6 sm:px-8 lg:px-10">
          <h2 id="how-heading" className={cn("text-center", uiHeadingSection)}>
            Comment ça marche
          </h2>
          <p className={cn("mx-auto mt-4 max-w-lg text-center sm:text-lg", uiBody)}>
            Un parcours clair, du premier clic au virement.
          </p>
          <div className="mt-12 grid gap-8 sm:grid-cols-3 sm:gap-6 lg:mt-14 lg:gap-8">
            {howSteps.map(({ step, title, body }, i) => (
              <motion.article
                key={step}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={fadeUpViewport}
                transition={{
                  duration: 0.5,
                  delay: i * 0.1,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className={cn(uiCard, uiCardLift, "px-6 py-8 sm:px-7 sm:py-9")}
              >
                <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-emerald-600 text-sm font-bold tabular-nums text-white shadow-sm">
                  {step}
                </span>
                <h3 className={cn("mt-5", uiHeadingCard)}>{title}</h3>
                <p className={cn("mt-3 sm:text-[15px]", uiBodySm)}>{body}</p>
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
