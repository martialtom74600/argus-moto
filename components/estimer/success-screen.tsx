"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  uiBody,
  uiBtnPrimaryBar,
  uiHeadingSection,
  uiOverline,
} from "@/lib/ui/site-ui";

const spring = { type: "spring" as const, stiffness: 300, damping: 30 };

export type SuccessScreenProps = {
  className?: string;
};

export function SuccessScreen({ className }: SuccessScreenProps) {
  return (
    <motion.div
      key="success-screen"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={spring}
      className={cn(
        "fixed inset-0 z-[130] flex flex-col items-center justify-center bg-[#FAFAFA] px-6",
        className
      )}
    >
      <div className="mx-auto max-w-md text-center">
        <p className={cn(uiOverline, "text-emerald-800")}>Conciergerie</p>
        <h2 className={cn("mt-3", uiHeadingSection)}>C&apos;est dans nos mains !</h2>
        <p className={cn("mt-5 text-slate-600", uiBody)}>
          Notre équipe vérifie vos photos. Votre annonce sera en ligne d&apos;ici
          quelques heures. Surveillez vos e-mails !
        </p>
        <Link
          href="/"
          className={cn(
            uiBtnPrimaryBar,
            "mt-10 inline-flex w-full max-w-sm justify-center no-underline hover:text-white"
          )}
        >
          Retour à l&apos;accueil
        </Link>
      </div>
    </motion.div>
  );
}
