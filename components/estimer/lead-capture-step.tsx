"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  uiBody,
  uiBodySm,
  uiBtnGhostBar,
  uiBtnPrimaryBar,
  uiHeadingSection,
  uiInput,
} from "@/lib/ui/site-ui";

export type LeadPayload = {
  firstName: string;
  email: string;
  phone: string;
};

export type LeadCaptureStepProps = {
  onBack: () => void;
  onContinue: (lead: LeadPayload) => void;
};

const spring = { type: "spring" as const, stiffness: 320, damping: 32 };

export function LeadCaptureStep({ onBack, onContinue }: LeadCaptureStepProps) {
  const [firstName, setFirstName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [hint, setHint] = React.useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setHint(null);
    const fn = firstName.trim();
    const em = email.trim();
    if (!fn) {
      setHint("Indiquez votre prénom.");
      return;
    }
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setHint("Adresse e-mail invalide.");
      return;
    }
    onContinue({
      firstName: fn,
      email: em,
      phone: phone.trim(),
    });
  };

  return (
    <motion.div
      key="lead-capture"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lead-capture-title"
      initial={{ opacity: 0, x: 28 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={spring}
      className="fixed inset-0 z-[125] flex flex-col bg-[#FDFDFD]/98 backdrop-blur-md"
    >
      <div className="mx-auto flex h-full min-h-0 w-full max-w-lg flex-col justify-center px-5 py-8 sm:px-8">
        <h2 id="lead-capture-title" className={cn(uiHeadingSection, "text-center")}>
          Où devons-nous vous contacter quand c&apos;est vendu ?
        </h2>
        <p
          className={cn(
            "mx-auto mt-4 max-w-md text-center text-sm text-slate-500 sm:mt-5",
            uiBody
          )}
        >
          Coordonnées réservées à l&apos;atelier Re-Ride — pas de revente à des
          tiers.
        </p>

        <form
          onSubmit={submit}
          className="mt-8 flex flex-col gap-4 sm:mt-10"
        >
          <div>
            <label htmlFor="lead-first-name" className="sr-only">
              Prénom
            </label>
            <input
              id="lead-first-name"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Prénom"
              className={cn(
                uiInput,
                "h-14 w-full rounded-2xl px-5 text-base font-medium"
              )}
            />
          </div>
          <div>
            <label htmlFor="lead-email" className="sr-only">
              E-mail
            </label>
            <input
              id="lead-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="E-mail"
              className={cn(
                uiInput,
                "h-14 w-full rounded-2xl px-5 text-base font-medium"
              )}
            />
          </div>
          <div>
            <label htmlFor="lead-phone" className="sr-only">
              Téléphone
            </label>
            <input
              id="lead-phone"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Téléphone (recommandé pour le suivi)"
              className={cn(
                uiInput,
                "h-14 w-full rounded-2xl px-5 text-base font-medium"
              )}
            />
            <p className={cn("mt-1.5 text-xs text-slate-500", uiBodySm)}>
              Optionnel mais recommandé pour un rappel rapide de l&apos;atelier.
            </p>
          </div>

          {hint ? (
            <p className="text-center text-xs font-medium text-amber-800" role="alert">
              {hint}
            </p>
          ) : null}

          <div className="mt-4 flex flex-col gap-3 sm:mt-6 sm:flex-row sm:justify-center sm:gap-4">
            <button
              type="button"
              onClick={onBack}
              className={cn(uiBtnGhostBar, "w-full justify-center sm:w-auto")}
            >
              Retour
            </button>
            <button type="submit" className={cn(uiBtnPrimaryBar, "w-full sm:w-auto")}>
              Continuer vers les photos
            </button>
          </div>
        </form>
      </div>
    </motion.div>
  );
}
