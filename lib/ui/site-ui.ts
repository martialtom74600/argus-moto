/**
 * Jetons visuels Re-Ride : une seule source pour home, formulaire et résultats.
 * Radius premium 3xl, bordures slate-200, ombre carte shadow-sm, survol shadow-md + translate.
 */

export const uiHeadingDisplay = "font-extrabold tracking-tighter text-slate-900";

export const uiHeadingSection =
  "text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl sm:leading-tight";

export const uiHeadingCard =
  "text-lg font-bold tracking-tight text-slate-900 sm:text-xl";

export const uiHeadingSub =
  "text-xl font-bold tracking-tight text-slate-900 sm:text-2xl";

export const uiBody = "text-base leading-relaxed text-slate-600";

export const uiBodySm = "text-sm leading-relaxed text-slate-600";

export const uiOverline =
  "text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500";

export const uiCard =
  "rounded-3xl border border-slate-200 bg-white shadow-sm";

export const uiCardLift =
  "transition-all duration-300 hover:-translate-y-1 hover:shadow-md";

export const uiPanelMuted = "rounded-3xl border border-slate-200 bg-slate-50/90";

export const uiInput =
  "rounded-3xl border border-slate-200 bg-white text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus-visible:border-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-500/25";

export const uiBtnPrimary =
  "inline-flex min-h-14 items-center justify-center rounded-3xl bg-emerald-600 px-10 text-base font-semibold tracking-tight text-white shadow-sm transition-[background-color,box-shadow,transform] duration-200 hover:bg-emerald-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-offset-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40";

/** CTA pleine largeur (hero). */
export const uiBtnPrimaryWide = `${uiBtnPrimary} w-full max-w-md sm:text-lg`;

/** Barre d’action formulaire (hauteur proche du hero). */
export const uiBtnPrimaryBar =
  "inline-flex min-h-14 items-center justify-center rounded-3xl bg-emerald-600 px-9 text-base font-semibold tracking-tight text-white shadow-sm transition-[background-color,box-shadow,transform] duration-200 hover:bg-emerald-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-offset-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 sm:min-h-[3.25rem] sm:px-10";

export const uiBtnNav =
  "inline-flex h-10 min-h-10 items-center justify-center rounded-3xl border border-emerald-700/15 bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm transition-[transform,background-color,box-shadow] duration-200 hover:bg-emerald-700 hover:shadow-md active:scale-[0.98]";

export const uiBtnGhostBar =
  "inline-flex h-12 min-h-12 items-center gap-2 rounded-3xl px-4 text-base font-semibold text-slate-600 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900";

export const uiLinkSubtle =
  "text-sm font-semibold text-slate-500 underline decoration-slate-300/80 underline-offset-[5px] transition-colors duration-200 hover:text-emerald-800 hover:decoration-emerald-400/80";

export const uiMotionHoverTap = {
  whileHover: { scale: 1.05 },
  whileTap: { scale: 0.98 },
} as const;
