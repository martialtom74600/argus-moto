"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  HelmetIcon,
  JacketIcon,
  GloveIcon,
  BootIcon,
  PantIcon,
} from "@/components/icons/category-icons";
import {
  ArrowLeft,
  CaretDown,
  Check,
  CheckCircle,
  MagnifyingGlass,
  Package,
  Shield,
} from "@phosphor-icons/react";
import {
  estimateRequestSchema,
  type CompletenessId,
  type HelmetAgeBand,
} from "@/lib/validation/estimateBody";
import type { CatalogModelRow } from "@/app/api/catalog/models/route";
import { cn } from "@/lib/utils";
import {
  uiBody,
  uiBodySm,
  uiBtnGhostBar,
  uiBtnPrimaryBar,
  uiCard,
  uiCardLift,
  uiHeadingCard,
  uiHeadingSection,
  uiHeadingSub,
  uiInput,
  uiLinkSubtle,
  uiOverline,
} from "@/lib/ui/site-ui";
import {
  LeadCaptureStep,
  type LeadPayload,
} from "@/components/estimer/lead-capture-step";
import {
  PhotoUploadStep,
  type PhotoSlotId,
} from "@/components/estimer/photo-upload-step";
import {
  ResultScreen,
  ResultTooOldScreen,
  type MarketRange,
} from "@/components/estimer/result-screen";
import { SuccessScreen } from "@/components/estimer/success-screen";
import { VisualFallbackStep } from "@/components/estimer/visual-fallback-step";

const TOTAL_STEPS = 6;
const ANALYSIS_MIN_VISIBLE_MS = 2000;
const PROGRESS_REVEAL_MS = 260;
const ANALYSIS_EXIT_MS = 560;
const SELECTION_FEEDBACK_MS = 300;

const BREADCRUMB_LABELS = [
  "Équipement",
  "Marque",
  "Modèle",
  "Patine",
  "Détails",
  "Sécurité",
] as const;

const STEP_COPY: Record<
  number,
  { title: string; subtitle: string }
> = {
  1: {
    title: "Qu’est-ce que vous souhaitez transmettre ?",
    subtitle:
      "Casque, textile, gants ou bottes : indiquez la famille de protection concernée.",
  },
  2: {
    title: "Quelle marque ?",
    subtitle:
      "Saisissez ou choisissez dans la liste : elle s’ouvre juste sous le champ et fait descendre la suite de la page, tout en fluidité.",
  },
  3: {
    title: "Quel modèle ?",
    subtitle:
      "Référence ou fiche catalogue : les propositions apparaissent en dessous ; sinon, continuez en texte libre.",
  },
  4: {
    title: "Patine et histoire du matériel",
    subtitle:
      "Soyez franc sur l’usage réel : la patine, les kilomètres de route, l’entretien — on affine au pas suivant.",
  },
  5: {
    title: "Les détails qui sécurisent l’estimation",
    subtitle:
      "Taille, contenu du lot, et pour un casque : ancienneté et intégrité de la coque.",
  },
  6: {
    title: "La sécurité avant tout",
    subtitle:
      "Un équipement doit protéger le pilote suivant comme il vous a protégé. Confirmez la véracité de ce que vous déclarez, puis lancez l’analyse.",
  },
};

/** Gants souvent &lt; 80 € — étape certifications allégée. */
function isLowValueEquipment(id: EquipmentId | null): boolean {
  return id === "gants";
}

type StreamProgressMsg = {
  type: "progress";
  phase: string;
  matched?: boolean;
  similarity?: number;
  stale?: boolean;
  instant?: boolean;
  forceLive?: boolean;
  orchestratorPath?: string;
  searchQuery?: string;
  ok?: boolean;
  medianEur?: number | null;
};

function formatStreamProgressMessage(raw: StreamProgressMsg): string {
  switch (raw.phase) {
    case "catalog_lookup":
      return "Catalogue · similarité…";
    case "catalog_result": {
      const pct = Math.round((raw.similarity ?? 0) * 100);
      if (!raw.matched) return `Pas de match ${pct} % — marché live`;
      if (raw.instant) return `Match ${pct} % — fiche fraîche`;
      if (raw.orchestratorPath === "catalog_refresh")
        return `Match ${pct} % — refresh marché`;
      if (raw.forceLive) return `Live forcé (${pct} %)`;
      return `Orchestration (${pct} %)`;
    }
    case "market_sync_start":
      return `Synchronisation marché UE · « ${raw.searchQuery ?? ""} »`;
    case "market_sync_done":
      if (raw.ok && raw.medianEur != null)
        return `Médiane neuf ≈ ${raw.medianEur} €`;
      return "Marché · sans médiane";
    case "persist_start":
      return "Persistance catalogue…";
    case "persist_done":
      return raw.ok ? "Catalogue synchronisé" : "Écriture partielle";
    case "matrix":
      return "Marge intelligente appliquée";
    default:
      return String(raw.phase);
  }
}

type EquipmentId =
  | "casque"
  | "blouson"
  | "gants"
  | "bottes"
  | "pantalon";

const EQUIPMENT_LABELS: Record<EquipmentId, string> = {
  casque: "Casque",
  blouson: "Blouson",
  pantalon: "Pantalon",
  gants: "Gants",
  bottes: "Bottes",
};
type ConditionId =
  | "neuf-etiquette"
  | "tres-bon"
  | "bon"
  | "etat-moyen";
type FlowPhase = "form" | "analyzing" | "result";

type ConciergeFlow = "idle" | "lead" | "photos" | "success";

type EstimateOfferResult = {
  kind: "offer";
  offer: number;
  /** Revente occasion typique (indicatif), même logique que le moteur. */
  estimatedResaleEur?: number;
  match: { brand: string; model: string; retailPrice: number };
  pricingSource: "catalog_instant" | "internal_crawler" | "argus_predictif";
  needsReview?: boolean;
  confidenceScore?: number;
  sourcesFound?: number;
  certifiedArgusMoto?: boolean;
  retailerSource?: string;
  isOfficialFeed?: boolean;
  /** Image choisie à la galerie Web (parcours hors catalogue). */
  pickedImageUrl?: string;
  marketPricingNote?: string;
  forcedCondition?: "ancien-modele";
  consistencyWarning?: string;
  needsManualVerification?: boolean;
};
type EstimateFallbackResult = {
  kind: "fallback";
  message: string;
  /** Renvoyé par l’API : afficher l’étape visuelle + prix neuf déclaré. */
  visualFallback?: boolean;
};
type EstimateTooOldResult = {
  kind: "too_old";
  maxAgeYears: number;
  categoryDisplayPlural: string;
};
type EstimateResult =
  | EstimateOfferResult
  | EstimateFallbackResult
  | EstimateTooOldResult;

/** Fourchette large : bas = rachat express, haut = vente directe indicative. */
function deriveMarketRange(
  estimatedResaleEur: number | undefined,
  engineOffer: number
): MarketRange | null {
  const resale =
    typeof estimatedResaleEur === "number" &&
    estimatedResaleEur > 0 &&
    Number.isFinite(estimatedResaleEur)
      ? Math.round(estimatedResaleEur)
      : null;
  const engine =
    typeof engineOffer === "number" &&
    Number.isFinite(engineOffer) &&
    engineOffer > 0
      ? Math.round(engineOffer)
      : null;

  if (resale != null && engine != null) {
    let low = Math.min(resale, engine);
    let high = Math.max(resale, engine);
    if (high <= low) {
      low = Math.max(1, Math.round(low * 0.85));
      high = Math.round(Math.max(resale, engine) * 1.15);
    } else {
      const spreadPct = ((high - low) / low) * 100;
      if (spreadPct < 10) {
        const mid = Math.round((low + high) / 2);
        low = Math.max(1, Math.round(mid * 0.88));
        high = Math.round(mid * 1.12);
      }
    }
    return { lowEur: low, highEur: Math.max(high, low) };
  }

  const mid = resale ?? engine;
  if (mid == null || mid <= 0) return null;

  return {
    lowEur: Math.max(1, Math.round(mid * 0.78)),
    highEur: Math.round(mid * 1.22),
  };
}

const equipmentOptions: {
  id: EquipmentId;
  icon: typeof HelmetIcon;
  label: string;
}[] = [
  { id: "casque", icon: HelmetIcon, label: EQUIPMENT_LABELS.casque },
  { id: "blouson", icon: JacketIcon, label: EQUIPMENT_LABELS.blouson },
  { id: "pantalon", icon: PantIcon, label: EQUIPMENT_LABELS.pantalon },
  { id: "gants", icon: GloveIcon, label: EQUIPMENT_LABELS.gants },
  { id: "bottes", icon: BootIcon, label: EQUIPMENT_LABELS.bottes },
];

const conditionOptions: {
  id: ConditionId;
  label: string;
  help: string;
}[] = [
  {
    id: "neuf-etiquette",
    label: "Neuf",
    help: "Jamais équipé en conditions réelles, étiquettes possibles, état showroom.",
  },
  {
    id: "tres-bon",
    label: "Très bon état",
    help: "Patine légère, pas de défaut structurel, matériel fiable et propre.",
  },
  {
    id: "bon",
    label: "Bon état",
    help: "Patine visible, rien qui compromette la protection : ensemble cohérent et prêt à rouler.",
  },
  {
    id: "etat-moyen",
    label: "Patine marquée",
    help: "Usure forte ou défauts visibles : la fourchette reflète un constat honnête.",
  },
];

const SECURITY_COPY = [
  "Je certifie être le propriétaire légitime de cet équipement.",
  "Je certifie que ces informations reflètent l’état réel du matériel.",
  "Je comprends qu’une déclaration inexacte peut invalider l’estimation.",
] as const;

/** Certification obligatoire casque — alignée sur la validation API. */
const PHYSICAL_INTEGRITY_COPY =
  "Je certifie que le produit ne présente aucune chute et que les coques sont d’origine. Toute fausse déclaration annulera l’offre lors de l’expertise physique.";

const HELMET_AGE_OPTIONS: {
  id: HelmetAgeBand;
  label: string;
}[] = [
  { id: "under-2", label: "Moins de 2 ans" },
  { id: "2-to-5", label: "2 à 5 ans" },
  { id: "over-5", label: "Plus de 5 ans" },
];

const COMPLETENESS_OPTIONS: { id: CompletenessId; label: string }[] = [
  { id: "complete", label: "Lot complet (boîte & accessoires d’origine)" },
  { id: "no-box", label: "Sans boîte d’origine" },
  { id: "accessories-missing", label: "Accessoires manquants" },
];

function useBodyScrollLock(lock: boolean) {
  React.useEffect(() => {
    if (!lock) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [lock]);
}

function useVisualViewportInset() {
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

const springTransition = {
  type: "spring" as const,
  stiffness: 320,
  damping: 32,
  mass: 0.9,
};

const stepVariants = {
  enter: (dir: number) => ({
    x: dir >= 0 ? 20 : -20,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({
    x: dir >= 0 ? -16 : 16,
    opacity: 0,
  }),
};

/** Libellé d’étape discret (la progression visuelle est dans la barre du header). */
function StepTrail({ activeStep }: { activeStep: number }) {
  const label = BREADCRUMB_LABELS[activeStep - 1];
  if (!label) return null;
  return (
    <motion.p
      key={activeStep}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={cn("mb-2 text-center sm:mb-3", uiOverline, "text-slate-400")}
    >
      {label}
    </motion.p>
  );
}

function StepGuidance({ step }: { step: number }) {
  const copy = STEP_COPY[step];
  if (!copy) return null;
  return (
    <div className="mx-auto w-full max-w-2xl px-1 text-center">
      <StepTrail activeStep={step} />
      <h2 className={cn(uiHeadingSection)}>{copy.title}</h2>
      <p className={cn("mx-auto mt-4 max-w-xl sm:mt-5 sm:text-lg", uiBody)}>
        {copy.subtitle}
      </p>
    </div>
  );
}

function BrandsSkeleton() {
  return (
    <div className="flex w-full max-w-xl flex-col gap-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-12 w-full animate-pulse rounded-3xl bg-slate-100 sm:h-[3.25rem]"
        />
      ))}
    </div>
  );
}

function AnalysisLogLines({
  lines,
  exiting,
}: {
  lines: string[];
  exiting: boolean;
}) {
  return (
    <motion.div
      className="mt-10 max-w-md space-y-2 px-6 text-center"
      animate={
        exiting
          ? { opacity: 0, y: -12, filter: "blur(6px)" }
          : { opacity: 1, y: 0, filter: "blur(0px)" }
      }
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <AnimatePresence initial={false}>
        {lines.map((line, i) => (
          <motion.p
            key={`${i}-${line.slice(0, 24)}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className={cn("text-[13px] font-medium tracking-wide", uiBodySm)}
          >
            {line}
          </motion.p>
        ))}
      </AnimatePresence>
    </motion.div>
  );
}

function PulsingAnalysisOrb({ exiting }: { exiting: boolean }) {
  return (
    <motion.div
      className="relative flex size-36 items-center justify-center sm:size-44"
      animate={
        exiting
          ? { scale: 1.35, opacity: 0 }
          : { scale: 1, opacity: 1 }
      }
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.div
        className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-400/25 via-emerald-600/15 to-transparent"
        animate={{ scale: [1, 1.08, 1], opacity: [0.5, 0.85, 0.5] }}
        transition={{
          duration: 2.8,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
      />
      <motion.div
        className="absolute inset-2 rounded-full border border-slate-200/80 bg-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-md"
        animate={{ scale: [1, 1.03, 1] }}
        transition={{
          duration: 2.2,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
      />
      <motion.div
        className="relative size-16 rounded-full bg-gradient-to-br from-emerald-700 to-emerald-900 shadow-md sm:size-[4.5rem]"
        style={{ boxShadow: "0 12px 40px -8px rgba(5,150,105,0.4)" }}
      />
    </motion.div>
  );
}

function TechnicalJournalDisclosure({ lines }: { lines: string[] }) {
  return (
    <details className="group mt-8 text-center">
      <summary className="cursor-pointer list-none text-[11px] font-semibold tracking-[0.14em] text-slate-500 transition hover:text-slate-700 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-1 border-b border-slate-300/80 pb-0.5">
          Voir le journal d’analyse
          <CaretDown className="size-3 transition group-open:rotate-180" />
        </span>
      </summary>
      <pre className="mx-auto mt-3 max-h-[30vh] max-w-lg overflow-hidden text-left font-mono text-[10px] leading-relaxed tracking-tight text-slate-500">
        {lines.length ? lines.join("\n") : "—"}
      </pre>
    </details>
  );
}

export function EstimationForm() {
  useBodyScrollLock(true);
  const router = useRouter();
  const keyboardPad = useVisualViewportInset();

  const [step, setStep] = React.useState(1);
  const [dir, setDir] = React.useState(1);
  const [equipment, setEquipment] = React.useState<EquipmentId | null>(null);
  const [brand, setBrand] = React.useState("");
  const [model, setModel] = React.useState("");
  const [declinaison, setDeclinaison] = React.useState("");
  const [condition, setCondition] = React.useState<ConditionId | null>(null);
  const [securityChecks, setSecurityChecks] = React.useState<
    [boolean, boolean, boolean, boolean]
  >([false, false, false, false]);
  const [flowPhase, setFlowPhase] = React.useState<FlowPhase>("form");
  const [estimateResult, setEstimateResult] =
    React.useState<EstimateResult | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [stepHint, setStepHint] = React.useState<string | null>(null);
  const [apiStreamLog, setApiStreamLog] = React.useState<string[]>([]);
  const [reassuranceLines, setReassuranceLines] = React.useState<string[]>([]);
  const [analysisExiting, setAnalysisExiting] = React.useState(false);
  const [brandOpen, setBrandOpen] = React.useState(false);
  const [catalogSlug, setCatalogSlug] = React.useState<string | null>(null);
  const [modelOpen, setModelOpen] = React.useState(false);
  const [distinctBrands, setDistinctBrands] = React.useState<string[]>([]);
  const [brandsLoading, setBrandsLoading] = React.useState(false);
  const [catalogModels, setCatalogModels] = React.useState<CatalogModelRow[]>(
    []
  );
  const [modelsLoading, setModelsLoading] = React.useState(false);
  const [catalogModelSelecting, setCatalogModelSelecting] = React.useState<
    string | null
  >(null);
  const [helmetAgeBand, setHelmetAgeBand] =
    React.useState<HelmetAgeBand | null>(null);
  const [hadImpact, setHadImpact] = React.useState<boolean | null>(null);
  const [equipmentSize, setEquipmentSize] = React.useState("");
  const [completeness, setCompleteness] =
    React.useState<CompletenessId>("complete");
  /** Année d’achat (obligatoire pour l’API / plafond d’âge). */
  const [purchaseYear, setPurchaseYear] = React.useState<number | null>(null);
  const [equipSelecting, setEquipSelecting] = React.useState<EquipmentId | null>(
    null
  );
  const [condSelecting, setCondSelecting] = React.useState<ConditionId | null>(
    null
  );
  const [conciergeFlow, setConciergeFlow] =
    React.useState<ConciergeFlow>("idle");
  const [visualFallbackBusy, setVisualFallbackBusy] = React.useState(false);
  const [capturedLead, setCapturedLead] = React.useState<LeadPayload | null>(
    null
  );
  const [leadPipelineSubmitting, setLeadPipelineSubmitting] =
    React.useState(false);
  const brandPanelRef = React.useRef<HTMLDivElement>(null);
  const modelPanelRef = React.useRef<HTMLDivElement>(null);
  const brandSearchRef = React.useRef<HTMLInputElement>(null);
  const modelInputRef = React.useRef<HTMLInputElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);
  const pendingResultRef = React.useRef<unknown>(null);
  const analysisStartedAtRef = React.useRef(0);
  const equipAdvanceTimerRef = React.useRef<number | null>(null);
  const condAdvanceTimerRef = React.useRef<number | null>(null);
  const modelPickTimerRef = React.useRef<number | null>(null);

  const resolvedBrandLabel = React.useMemo(() => {
    const t = brand.trim().toLowerCase();
    const hit = distinctBrands.find((b) => b.toLowerCase() === t);
    return (hit ?? brand).trim();
  }, [brand, distinctBrands]);

  const purchaseYearChoices = React.useMemo(() => {
    const y = new Date().getFullYear();
    const years: number[] = [];
    for (let yr = y; yr >= 1990; yr -= 1) years.push(yr);
    return years;
  }, []);

  const brandChoices = React.useMemo(() => {
    const q = brand.trim().toLowerCase();
    if (!q) return distinctBrands.slice(0, 100);
    return distinctBrands
      .filter((b) => b.toLowerCase().includes(q))
      .slice(0, 100);
  }, [brand, distinctBrands]);

  const modelSuggestions = React.useMemo(() => {
    const q = model.trim().toLowerCase();
    if (!q) return catalogModels.slice(0, 12);
    return catalogModels
      .filter((r) => {
        const m = r.model.toLowerCase();
        return m.includes(q) || m.replace(/\s+/g, " ").includes(q);
      })
      .slice(0, 12);
  }, [catalogModels, model]);

  const commitEstimateResult = React.useCallback((data: unknown) => {
    const rec = data as Record<string, unknown>;
    if (rec.blocked === true && rec.blockReason === "TOO_OLD") {
      const maxAgeYears = rec.maxAgeYears;
      const categoryDisplayPlural = rec.categoryDisplayPlural;
      if (
        typeof maxAgeYears === "number" &&
        Number.isFinite(maxAgeYears) &&
        typeof categoryDisplayPlural === "string"
      ) {
        setEstimateResult({
          kind: "too_old",
          maxAgeYears,
          categoryDisplayPlural,
        });
        setConciergeFlow("idle");
        setCapturedLead(null);
        setFlowPhase("result");
        return;
      }
    }

    const msg =
      typeof (data as { message?: string }).message === "string"
        ? (data as { message: string }).message
        : null;
    const success = (data as { success?: unknown }).success === true;
    const fallback = (data as { fallback?: unknown }).fallback === true;
    const offer = (data as { offer?: unknown }).offer;
    const match = (data as { match?: unknown }).match;

    if (
      success &&
      typeof offer === "number" &&
      Number.isFinite(offer) &&
      match &&
      typeof match === "object"
    ) {
      const m = match as Record<string, unknown>;
      const mb = m.brand;
      const mm = m.model;
      const mr = m.retailPrice;
      if (
        typeof mb === "string" &&
        typeof mm === "string" &&
        typeof mr === "number" &&
        Number.isFinite(mr)
      ) {
        const d = data as Record<string, unknown>;
        const ps = d.pricingSource;
        const pricingSource =
          ps === "catalog_instant" ||
          ps === "internal_crawler" ||
          ps === "argus_predictif"
            ? ps
            : "argus_predictif";
        const resaleRaw = d.estimatedResaleEur ?? d.estimated_resale_eur;
        const estimatedResaleEur =
          typeof resaleRaw === "number" && Number.isFinite(resaleRaw)
            ? Math.round(resaleRaw)
            : undefined;
        const pickedImg =
          typeof d.pickedImageUrl === "string" && d.pickedImageUrl.trim()
            ? d.pickedImageUrl.trim()
            : typeof d.picked_image_url === "string" && d.picked_image_url.trim()
              ? d.picked_image_url.trim()
              : undefined;
        const marketPricingNote =
          typeof d.marketPricingNote === "string" && d.marketPricingNote.trim()
            ? d.marketPricingNote.trim()
            : undefined;
        const forcedCondition =
          d.forcedCondition === "ancien-modele"
            ? ("ancien-modele" as const)
            : undefined;
        const consistencyWarningRaw =
          d.consistencyWarning ?? d.consistency_warning;
        const consistencyWarning =
          typeof consistencyWarningRaw === "string" &&
          consistencyWarningRaw.trim()
            ? consistencyWarningRaw.trim()
            : undefined;
        const needsManualVerification =
          d.needsManualVerification === true ||
          d.needs_manual_verification === true;
        setEstimateResult({
          kind: "offer",
          offer,
          ...(estimatedResaleEur != null ? { estimatedResaleEur } : {}),
          match: { brand: mb, model: mm, retailPrice: mr },
          pricingSource,
          needsReview: d.needsReview === true,
          certifiedArgusMoto: d.certifiedArgusMoto === true,
          retailerSource:
            typeof d.retailerSource === "string" ? d.retailerSource : undefined,
          isOfficialFeed: d.isOfficialFeed === true,
          confidenceScore:
            typeof d.confidenceScore === "number" &&
            Number.isFinite(d.confidenceScore)
              ? d.confidenceScore
              : typeof d.confidence_score === "number" &&
                  Number.isFinite(d.confidence_score)
                ? d.confidence_score
                : undefined,
          sourcesFound:
            typeof d.sourcesFound === "number" &&
            Number.isFinite(d.sourcesFound)
              ? d.sourcesFound
              : undefined,
          ...(pickedImg ? { pickedImageUrl: pickedImg } : {}),
          ...(marketPricingNote ? { marketPricingNote } : {}),
          ...(forcedCondition ? { forcedCondition } : {}),
          ...(consistencyWarning ? { consistencyWarning } : {}),
          ...(needsManualVerification ? { needsManualVerification } : {}),
        });
        setConciergeFlow("idle");
        setCapturedLead(null);
        setFlowPhase("result");
        return;
      }
    }

    if (!success && fallback && typeof msg === "string") {
      setConciergeFlow("idle");
      setCapturedLead(null);
      const d = data as { visualFallback?: unknown };
      setEstimateResult({
        kind: "fallback",
        message: msg,
        visualFallback: d.visualFallback === true,
      });
      setFlowPhase("result");
      return;
    }

    setSubmitError(msg ?? "Réponse invalide.");
    setConciergeFlow("idle");
    setCapturedLead(null);
    setFlowPhase("form");
  }, []);

  React.useEffect(() => {
    return () => {
      if (equipAdvanceTimerRef.current != null) {
        window.clearTimeout(equipAdvanceTimerRef.current);
      }
      if (condAdvanceTimerRef.current != null) {
        window.clearTimeout(condAdvanceTimerRef.current);
      }
      if (modelPickTimerRef.current != null) {
        window.clearTimeout(modelPickTimerRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (step === 2 && !brandPanelRef.current?.contains(t)) {
        setBrandOpen(false);
      }
      if (step === 3 && !modelPanelRef.current?.contains(t)) {
        setModelOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [step]);

  React.useEffect(() => {
    if (step !== 2) setBrandOpen(false);
    if (step !== 3) setModelOpen(false);
  }, [step]);

  React.useEffect(() => {
    if (!analysisExiting || !pendingResultRef.current) return;
    const body = pendingResultRef.current;
    const t = window.setTimeout(() => {
      pendingResultRef.current = null;
      setAnalysisExiting(false);
      commitEstimateResult(body);
    }, ANALYSIS_EXIT_MS);
    return () => window.clearTimeout(t);
  }, [analysisExiting, commitEstimateResult]);

  React.useEffect(() => {
    if (flowPhase !== "form" || step !== 2) return;
    const id = window.requestAnimationFrame(() => {
      brandSearchRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [flowPhase, step]);

  React.useEffect(() => {
    if (flowPhase !== "form" || step !== 3) return;
    setModelOpen(true);
    const id = window.requestAnimationFrame(() => {
      modelInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [flowPhase, step]);

  React.useEffect(() => {
    if (step !== 2 || !equipment || flowPhase !== "form") return;
    let cancelled = false;
    setBrandsLoading(true);
    fetch(`/api/catalog/brands?category=${encodeURIComponent(equipment)}`)
      .then((r) => r.json())
      .then((json: { brands?: string[] }) => {
        if (cancelled) return;
        if (Array.isArray(json.brands)) setDistinctBrands(json.brands);
        else setDistinctBrands([]);
      })
      .catch(() => {
        if (!cancelled) setDistinctBrands([]);
      })
      .finally(() => {
        if (!cancelled) setBrandsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, equipment, flowPhase]);

  React.useEffect(() => {
    if (step !== 3 || !equipment || !brand.trim() || flowPhase !== "form")
      return;
    let cancelled = false;
    setModelsLoading(true);
    setCatalogModels([]);
    const q = new URLSearchParams({
      category: equipment,
      brand: brand.trim(),
    });
    fetch(`/api/catalog/models?${q}`)
      .then((r) => r.json())
      .then((json: { models?: CatalogModelRow[] }) => {
        if (cancelled) return;
        setCatalogModels(Array.isArray(json.models) ? json.models : []);
      })
      .catch(() => {
        if (!cancelled) setCatalogModels([]);
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, equipment, brand, flowPhase]);

  React.useEffect(() => {
    if (flowPhase !== "analyzing") {
      setReassuranceLines([]);
      return;
    }
    const product =
      `${brand.trim()} ${model.trim()}`.trim() || "équipement";
    const lines = [
      `Analyse de votre ${product}…`,
      "Croisement avec le marché européen…",
      "Établissement de votre fourchette de transmission…",
    ];
    setReassuranceLines([]);
    const tids = lines.map((line, i) =>
      window.setTimeout(() => {
        setReassuranceLines((prev) => [...prev, line]);
      }, i * 850)
    );
    return () => tids.forEach(clearTimeout);
  }, [flowPhase, brand, model]);

  const clearEquipAdvanceTimer = React.useCallback(() => {
    if (equipAdvanceTimerRef.current != null) {
      window.clearTimeout(equipAdvanceTimerRef.current);
      equipAdvanceTimerRef.current = null;
    }
    setEquipSelecting(null);
  }, []);

  const clearCondAdvanceTimer = React.useCallback(() => {
    if (condAdvanceTimerRef.current != null) {
      window.clearTimeout(condAdvanceTimerRef.current);
      condAdvanceTimerRef.current = null;
    }
    setCondSelecting(null);
  }, []);

  const stepForward = React.useCallback((from: number) => {
    setDir(1);
    setStep(Math.min(TOTAL_STEPS, from + 1));
  }, []);

  const stepBack = React.useCallback(
    (from: number) => {
      clearEquipAdvanceTimer();
      clearCondAdvanceTimer();
      if (modelPickTimerRef.current != null) {
        window.clearTimeout(modelPickTimerRef.current);
        modelPickTimerRef.current = null;
      }
      setDir(-1);
      if (from === 3) {
        setCatalogSlug(null);
        setCatalogModelSelecting(null);
        setModel("");
        setDeclinaison("");
      }
      if (from === 4) {
        setCatalogSlug(null);
        setCatalogModelSelecting(null);
      }
      setStep(Math.max(1, from - 1));
    },
    [clearCondAdvanceTimer, clearEquipAdvanceTimer]
  );

  const lowValue = isLowValueEquipment(equipment);

  const securityStepValid =
    lowValue ||
    (securityChecks[0] &&
      securityChecks[1] &&
      securityChecks[2] &&
      (equipment !== "casque" || securityChecks[3]));

  const canGoNext = React.useMemo(() => {
    if (step === 1) return equipment !== null;
    if (step === 2) return brand.trim() !== "";
    if (step === 3) return model.trim() !== "";
    if (step === 4) return condition !== null && equipment !== null;
    if (step === 5) {
      if (!equipment) return false;
      if (purchaseYear == null) return false;
      if (equipment === "casque") {
        if (!helmetAgeBand || hadImpact === null) return false;
        if (hadImpact === true) return false;
      }
      if (
        (equipment === "gants" || equipment === "bottes") &&
        !equipmentSize.trim()
      )
        return false;
      return true;
    }
    if (step === 6) return securityStepValid;
    return true;
  }, [
    step,
    equipment,
    brand,
    model,
    condition,
    securityStepValid,
    helmetAgeBand,
    hadImpact,
    equipmentSize,
    purchaseYear,
  ]);

  const canSubmitEstimation =
    step === TOTAL_STEPS &&
    securityStepValid &&
    equipment !== null &&
    condition !== null &&
    purchaseYear != null &&
    (Boolean(catalogSlug?.length) ||
      (brand.trim().length > 0 && model.trim().length > 0));

  const tryAdvance = () => {
    setStepHint(null);
    if (step === 1 && !canGoNext) {
      setStepHint("Indiquez une catégorie d’équipement.");
      return;
    }
    if (step === 2 && !canGoNext) {
      setStepHint("Indiquez une marque (ou choisissez-la dans la liste).");
      return;
    }
    if (step === 3 && !canGoNext) {
      setStepHint("Indiquez un modèle ou choisissez une fiche catalogue.");
      return;
    }
    if (step === 4 && !canGoNext) {
      setStepHint("Indiquez le niveau de patine le plus proche de la réalité.");
      return;
    }
    if (step === 5 && !canGoNext) {
      if (purchaseYear == null) {
        setStepHint("Indiquez l’année d’achat de l’équipement.");
        return;
      }
      if (equipment === "casque" && hadImpact === true) {
        setStepHint(
          "Un casque ayant subi un choc n’est pas traitable en ligne — écrivez-nous pour une relecture experte."
        );
        return;
      }
      setStepHint(
        "Complétez les champs requis (âge du casque, taille des gants ou bottes…)."
      );
      return;
    }
    if (step === 6 && !canGoNext) {
      setStepHint(
        equipment === "casque" && !securityChecks[3]
          ? "Cochez la certification sur l’intégrité du casque et l’origine des coques."
          : "Validez tous les engagements pour poursuivre."
      );
      return;
    }
    stepForward(step);
  };

  const selectEquipment = (id: EquipmentId) => {
    if (equipAdvanceTimerRef.current != null) return;
    setEquipment(id);
    setEquipSelecting(id);
    setStepHint(null);
    setCatalogSlug(null);
    setDistinctBrands([]);
    setCatalogModels([]);
    setBrand("");
    setModel("");
    setDeclinaison("");
    equipAdvanceTimerRef.current = window.setTimeout(() => {
      equipAdvanceTimerRef.current = null;
      setEquipSelecting(null);
      setDir(1);
      setStep(2);
      setSecurityChecks([false, false, false, false]);
      setHelmetAgeBand(null);
      setHadImpact(null);
      setEquipmentSize("");
      setPurchaseYear(null);
      setCompleteness("complete");
    }, SELECTION_FEEDBACK_MS);
  };

  const selectCondition = (id: ConditionId) => {
    if (condAdvanceTimerRef.current != null) return;
    setCondition(id);
    setCondSelecting(id);
    setStepHint(null);
    condAdvanceTimerRef.current = window.setTimeout(() => {
      condAdvanceTimerRef.current = null;
      setCondSelecting(null);
    }, SELECTION_FEEDBACK_MS);
  };

  const selectCatalogModel = (row: CatalogModelRow) => {
    if (modelPickTimerRef.current != null) return;
    setCatalogSlug(row.canonical_slug);
    setModel(row.model);
    setBrandOpen(false);
    setModelOpen(false);
    setStepHint(null);
    setCatalogModelSelecting(row.canonical_slug);
    modelPickTimerRef.current = window.setTimeout(() => {
      modelPickTimerRef.current = null;
      setCatalogModelSelecting(null);
      setDir(1);
      setStep(4);
    }, SELECTION_FEEDBACK_MS);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitEstimation || !equipment || !condition) return;

    const useCatalog = Boolean(catalogSlug?.trim()) && catalogSlug != null;

    if (purchaseYear == null) {
      setSubmitError("Indiquez l’année d’achat.");
      return;
    }

    const detailPayload = {
      completeness,
      ...(equipment === "casque" && helmetAgeBand && hadImpact !== null
        ? {
            helmetAgeBand,
            hadImpact: hadImpact === true,
          }
        : {}),
      ...(equipmentSize.trim()
        ? { equipmentSize: equipmentSize.trim() }
        : {}),
    };

    const integrityField =
      equipment === "casque"
        ? { physicalIntegrityCertified: securityChecks[3] }
        : {};

    const payload = useCatalog
      ? {
          canonical_slug: catalogSlug.trim(),
          category: equipment,
          condition,
          purchaseYear,
          ...detailPayload,
          ...integrityField,
          ...(declinaison.trim() ? { declinaison: declinaison.trim() } : {}),
        }
      : {
          brand: brand.trim(),
          model: model.trim(),
          category: equipment,
          condition,
          purchaseYear,
          ...detailPayload,
          ...integrityField,
          ...(declinaison.trim() ? { declinaison: declinaison.trim() } : {}),
          ...(!useCatalog ? { forceVisualFallback: true as const } : {}),
        };
    const validated = estimateRequestSchema.safeParse(payload);
    if (!validated.success) {
      const flat = validated.error.flatten();
      const first =
        flat.formErrors[0] ??
        Object.values(flat.fieldErrors).flat()[0] ??
        "Données invalides.";
      setSubmitError(first);
      return;
    }

    setSubmitError(null);
    setEstimateResult(null);
    setApiStreamLog([]);
    analysisStartedAtRef.current = Date.now();
    setFlowPhase("analyzing");
    setAnalysisExiting(false);
    pendingResultRef.current = null;

    const waitMin = async () => {
      const elapsed = Date.now() - analysisStartedAtRef.current;
      const rest = Math.max(0, ANALYSIS_MIN_VISIBLE_MS - elapsed);
      if (rest > 0) await new Promise((r) => setTimeout(r, rest));
    };

    try {
      const res = await fetch("/api/estimate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify(payload),
      });

      const ct = res.headers.get("content-type") ?? "";

      if (ct.includes("application/json")) {
        const data: unknown = await res.json().catch(() => ({}));
        const msg =
          typeof (data as { message?: string }).message === "string"
            ? (data as { message: string }).message
            : null;
        if (!res.ok) {
          setSubmitError(msg ?? "Échec du calcul.");
          setFlowPhase("form");
          return;
        }
        setApiStreamLog((prev) =>
          prev.includes("Analyse terminée") ? prev : [...prev, "Analyse terminée"]
        );
        await waitMin();
        pendingResultRef.current = data;
        setAnalysisExiting(true);
        return;
      }

      if (!res.ok || !res.body) {
        setSubmitError("Réponse serveur inattendue.");
        setFlowPhase("form");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let resultPayload: { status: number; body: unknown } | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            continue;
          }
          const row = parsed as { type?: string };
          if (row.type === "progress") {
            const label = formatStreamProgressMessage(row as StreamProgressMsg);
            await new Promise((r) => setTimeout(r, PROGRESS_REVEAL_MS));
            setApiStreamLog((prev) => [...prev, label]);
          } else if (row.type === "result") {
            const r = parsed as { status?: number; body?: unknown };
            resultPayload = {
              status: typeof r.status === "number" ? r.status : res.status,
              body: r.body,
            };
          } else if (row.type === "error") {
            const r = parsed as { message?: string };
            setSubmitError(
              typeof r.message === "string" ? r.message : "Erreur."
            );
            setFlowPhase("form");
            return;
          }
        }
      }

      if (!resultPayload) {
        setSubmitError("Flux incomplet.");
        setFlowPhase("form");
        return;
      }

      if (resultPayload.status >= 400) {
        const b = resultPayload.body as { message?: string };
        setSubmitError(
          typeof b?.message === "string" ? b.message : "Erreur serveur."
        );
        setFlowPhase("form");
        return;
      }

      setApiStreamLog((prev) =>
        prev.includes("Analyse terminée") ? prev : [...prev, "Analyse terminée"]
      );
      await waitMin();
      pendingResultRef.current = resultPayload.body;
      setAnalysisExiting(true);
    } catch {
      setSubmitError("Réseau indisponible.");
      setFlowPhase("form");
    }
  };

  const reset = () => {
    clearEquipAdvanceTimer();
    clearCondAdvanceTimer();
    if (modelPickTimerRef.current != null) {
      window.clearTimeout(modelPickTimerRef.current);
      modelPickTimerRef.current = null;
    }
    setStep(1);
    setDir(1);
    setEquipment(null);
    setBrand("");
    setModel("");
    setDeclinaison("");
    setCondition(null);
    setSecurityChecks([false, false, false, false]);
    setFlowPhase("form");
    setEstimateResult(null);
    setSubmitError(null);
    setStepHint(null);
    setApiStreamLog([]);
    setReassuranceLines([]);
    setAnalysisExiting(false);
    pendingResultRef.current = null;
    setCatalogSlug(null);
    setDistinctBrands([]);
    setCatalogModels([]);
    setBrandOpen(false);
    setModelOpen(false);
    setCatalogModelSelecting(null);
    setHelmetAgeBand(null);
    setHadImpact(null);
    setEquipmentSize("");
    setCompleteness("complete");
    setPurchaseYear(null);
    setConciergeFlow("idle");
    setCapturedLead(null);
    setLeadPipelineSubmitting(false);
    setVisualFallbackBusy(false);
  };

  const equipmentLabel = equipment ? EQUIPMENT_LABELS[equipment] : "";
  const conditionLabel =
    conditionOptions.find((o) => o.id === condition)?.label ?? "";

  const progressFraction = React.useMemo(() => {
    if (flowPhase === "result") return 1;
    if (flowPhase === "analyzing") return 1;
    return step / TOTAL_STEPS;
  }, [flowPhase, step]);

  const renderResultOffer = () => {
    if (estimateResult?.kind !== "offer") return null;
    if (!equipment || !condition) return null;
    const {
      estimatedResaleEur,
      offer: engineOffer,
      match,
      needsReview,
      confidenceScore,
      certifiedArgusMoto,
      pricingSource,
      sourcesFound,
      retailerSource,
      isOfficialFeed,
      pickedImageUrl,
      marketPricingNote,
      forcedCondition,
      consistencyWarning,
      needsManualVerification,
    } = estimateResult;

    const displayedConditionLabel =
      forcedCondition === "ancien-modele"
        ? "Ancien modèle (réf. marché)"
        : conditionLabel;

    const resaleDisplay =
      typeof estimatedResaleEur === "number" && estimatedResaleEur > 0
        ? estimatedResaleEur
        : null;

    const coteArgusDisplay =
      resaleDisplay ??
      (typeof engineOffer === "number" &&
      Number.isFinite(engineOffer) &&
      engineOffer > 0
        ? Math.round(engineOffer)
        : null);

    const marketRange = deriveMarketRange(estimatedResaleEur, engineOffer);

    const annoncesMention =
      typeof sourcesFound === "number" && sourcesFound > 0
        ? `À partir de ${sourcesFound} cession${sourcesFound > 1 ? "s" : ""} récente${sourcesFound > 1 ? "s" : ""} de matériel comparable.`
        : "À partir de cessions comparables récemment observées sur le marché.";

    const recapImageUrl =
      pickedImageUrl ??
      (catalogSlug
        ? (catalogModels.find((r) => r.canonical_slug === catalogSlug)
            ?.image_url ?? null)
        : null);
    const EquipIcon = equipment
      ? (equipmentOptions.find((e) => e.id === equipment)?.icon ?? HelmetIcon)
      : HelmetIcon;
    const completenessLabel =
      COMPLETENESS_OPTIONS.find((o) => o.id === completeness)?.label ?? "";
    const helmetAgeLabel =
      equipment === "casque" && helmetAgeBand
        ? HELMET_AGE_OPTIONS.find((o) => o.id === helmetAgeBand)?.label
        : null;
    const retailFmt = new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(match.retailPrice);

    const aside = (
          <aside className="lg:col-span-5">
            <div
              className={cn(
                uiCard,
                uiCardLift,
                "relative overflow-hidden bg-gradient-to-b from-white via-slate-50/40 to-white",
                "lg:sticky lg:top-6"
              )}
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-slate-300/60 to-transparent" />
              <div className="p-6 sm:p-7">
                <div className="flex items-center gap-2 text-slate-500">
                  <Package
                    className="size-4 shrink-0 opacity-70"
                    weight="regular"
                    aria-hidden
                  />
                  <span className={cn(uiOverline, "text-slate-500")}>Votre équipement</span>
                </div>

                <p className="mt-4 text-center text-sm font-semibold leading-snug text-slate-800 sm:text-[15px]">
                  Voici notre offre pour votre modèle&nbsp;: {match.model}
                </p>

                <div className="relative mx-auto mt-4 aspect-[4/3] w-full max-w-[280px] overflow-hidden rounded-3xl border border-slate-200/80 bg-slate-100 sm:max-w-none">
                  {recapImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={recapImageUrl}
                      alt=""
                      className="size-full object-contain mix-blend-multiply"
                    />
                  ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200/60">
                      <EquipIcon
                        className="size-20 text-slate-400 sm:size-24"
                        aria-hidden
                      />
                      <span className="px-4 text-center text-xs font-medium text-slate-400">
                        Visuel indicatif
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-6 space-y-1 text-center sm:mt-7">
                  <p className="inline-flex items-center justify-center gap-1.5 rounded-full border border-slate-200/90 bg-white/80 px-3 py-1 text-[11px] font-medium text-slate-600">
                    <EquipIcon className="size-4 shrink-0 sm:size-[1.15rem]" />
                    {equipmentLabel}
                  </p>
                  <h3 className={cn("mt-3 leading-tight", uiHeadingSub)}>
                    {match.brand}
                  </h3>
                  <p className="text-base font-medium text-slate-600 sm:text-lg">
                    {match.model}
                  </p>
                  {declinaison.trim() ? (
                    <p className="text-sm text-slate-500">
                      {declinaison.trim()}
                    </p>
                  ) : null}
                </div>

                <div className="mt-6 space-y-0 border-t border-slate-200/80 pt-5">
                  {[
                    ["Patine déclarée", displayedConditionLabel],
                    ["Contenu du lot", completenessLabel],
                    equipmentSize.trim()
                      ? ["Taille / pointure", equipmentSize.trim()]
                      : null,
                    helmetAgeLabel
                      ? ["Âge du casque", helmetAgeLabel]
                      : null,
                  ]
                    .filter(Boolean)
                    .map((row, i) => {
                      const [k, v] = row as [string, string];
                      return (
                        <div
                          key={`${k}-${i}`}
                          className="flex justify-between gap-4 border-b border-slate-100/90 py-2.5 text-sm last:border-b-0"
                        >
                          <span className="shrink-0 text-slate-400">{k}</span>
                          <span className="text-right font-medium text-slate-800">
                            {v}
                          </span>
                        </div>
                      );
                    })}
                </div>

                <div className="mt-5 rounded-3xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 text-center shadow-sm">
                  <p className={cn("text-[10px] tracking-[0.12em]", uiOverline, "text-slate-500")}>
                    Référence prix neuf
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums tracking-tight text-slate-900">
                    {retailFmt}
                  </p>
                </div>

                {marketRange ? (
                  <div className="mt-3 rounded-3xl border border-emerald-200/90 bg-emerald-50/60 px-4 py-3 text-center shadow-sm">
                    <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-emerald-800/65">
                      Valeur estimée sur le marché
                    </p>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-950">
                      {marketRange.lowEur} € — {marketRange.highEur} €
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </aside>
    );

    const metadataPayload = {
      brand: match.brand,
      model: match.model,
      category: equipment,
      conditionLabel: displayedConditionLabel,
      catalogSlug: catalogSlug ?? null,
      retailReferenceEur: Math.round(match.retailPrice),
      completeness: completenessLabel,
      equipmentSize: equipmentSize.trim() || undefined,
      helmetAgeBand: helmetAgeBand ?? undefined,
      hadImpact:
        equipment === "casque" && hadImpact !== null ? hadImpact : undefined,
      declinaison: declinaison.trim() || undefined,
      certifiedArgus: certifiedArgusMoto,
      coteArgusEur: marketRange?.highEur ?? coteArgusDisplay,
      offerEngineEur: marketRange?.lowEur ?? Math.round(engineOffer),
      snapshot: {
        pricingSource,
        sourcesFound,
        ficheCatalogueSlug: catalogSlug ?? null,
        horsFicheCatalogue: catalogSlug == null,
        completenessId: completeness,
        conditionId: condition,
        equipment,
        marketRangeLowEur: marketRange?.lowEur,
        marketRangeHighEur: marketRange?.highEur,
      },
    };

    const submitSellerLead = async (photos: Partial<Record<PhotoSlotId, File>>, pilotStory: string) => {
      if (!capturedLead) throw new Error("Session expirée : recommencez depuis l’étape contact.");
      const fd = new FormData();
      fd.append("first_name", capturedLead.firstName);
      fd.append("email", capturedLead.email);
      fd.append("phone", capturedLead.phone);
      fd.append("pilot_story", pilotStory);
      fd.append("metadata", JSON.stringify(metadataPayload));
      for (const slot of ["face", "back", "label", "wear"] as PhotoSlotId[]) {
        const f = photos[slot];
        if (f) fd.append(`photo_${slot}`, f);
      }
      const res = await fetch("/api/seller-leads", { method: "POST", body: fd });
      const json = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok) {
        throw new Error(typeof json.message === "string" ? json.message : "Échec envoi");
      }
    };

    return (
      <>
        <ResultScreen
          keyboardPad={keyboardPad}
          marketRange={marketRange}
          certifiedArgusMoto={certifiedArgusMoto}
          annoncesMention={annoncesMention}
          retailFmt={retailFmt}
          isOfficialFeed={isOfficialFeed}
          retailerSource={retailerSource}
          sourcesFound={sourcesFound}
          pricingSource={pricingSource}
          marketPricingNote={marketPricingNote}
          consistencyWarning={consistencyWarning}
          needsManualVerification={needsManualVerification}
          helmetOfferDisclaimer={equipment === "casque"}
          needsReview={needsReview}
          confidenceScore={confidenceScore}
          onArgusExpress={() => setConciergeFlow("lead")}
          onPreferSellMyself={() => {
            reset();
            router.push("/");
          }}
          onRestartEstimate={reset}
          aside={aside}
          hidden={conciergeFlow !== "idle"}
        />
        <AnimatePresence mode="wait">
          {conciergeFlow === "lead" ? (
            <LeadCaptureStep
              key="lead"
              onBack={() => setConciergeFlow("idle")}
              onContinue={(lead) => {
                setCapturedLead(lead);
                setConciergeFlow("photos");
              }}
            />
          ) : null}
          {conciergeFlow === "photos" && capturedLead ? (
            <PhotoUploadStep
              key="photos"
              onBack={() => setConciergeFlow("lead")}
              isSubmitting={leadPipelineSubmitting}
              onSubmit={async ({ photos, pilotStory }) => {
                setLeadPipelineSubmitting(true);
                try {
                  await submitSellerLead(photos, pilotStory);
                  setConciergeFlow("success");
                } finally {
                  setLeadPipelineSubmitting(false);
                }
              }}
            />
          ) : null}
          {conciergeFlow === "success" ? <SuccessScreen key="success" /> : null}
        </AnimatePresence>
      </>
    );
  };

  const renderResultTooOld = () => {
    if (estimateResult?.kind !== "too_old") return null;
    if (!equipment || !condition) return null;

    const { maxAgeYears, categoryDisplayPlural } = estimateResult;

    const EquipIconToo = equipment
      ? (equipmentOptions.find((e) => e.id === equipment)?.icon ?? HelmetIcon)
      : HelmetIcon;
    const completenessLabelToo =
      COMPLETENESS_OPTIONS.find((o) => o.id === completeness)?.label ?? "";
    const helmetAgeLabelToo =
      equipment === "casque" && helmetAgeBand
        ? HELMET_AGE_OPTIONS.find((o) => o.id === helmetAgeBand)?.label
        : null;

    const recapImageUrlToo =
      catalogSlug != null
        ? (catalogModels.find((r) => r.canonical_slug === catalogSlug)
            ?.image_url ?? null)
        : null;

    const modelDisplayToo = [model.trim(), declinaison.trim()]
      .filter(Boolean)
      .join(" ")
      .trim();

    const asideTooOld = (
      <aside className="lg:col-span-5">
        <div
          className={cn(
            uiCard,
            uiCardLift,
            "relative overflow-hidden bg-gradient-to-b from-white via-slate-50/40 to-white",
            "lg:sticky lg:top-6"
          )}
        >
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-slate-300/60 to-transparent" />
          <div className="p-6 sm:p-7">
            <div className="flex items-center gap-2 text-slate-500">
              <Package
                className="size-4 shrink-0 opacity-70"
                weight="regular"
                aria-hidden
              />
              <span className={cn(uiOverline, "text-slate-500")}>
                Votre équipement
              </span>
            </div>

            <p className="mt-4 text-center text-sm font-semibold leading-snug text-slate-800 sm:text-[15px]">
              Récapitulatif — pas d&apos;offre de rachat en ligne
            </p>

            <div className="relative mx-auto mt-4 aspect-[4/3] w-full max-w-[280px] overflow-hidden rounded-3xl border border-slate-200/80 bg-slate-100 sm:max-w-none">
              {recapImageUrlToo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={recapImageUrlToo}
                  alt=""
                  className="size-full object-contain mix-blend-multiply"
                />
              ) : (
                <div className="flex size-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200/60">
                  <EquipIconToo
                    className="size-20 text-slate-400 sm:size-24"
                    aria-hidden
                  />
                </div>
              )}
            </div>

            <div className="mt-6 space-y-1 text-center sm:mt-7">
              <p className="inline-flex items-center justify-center gap-1.5 rounded-full border border-slate-200/90 bg-white/80 px-3 py-1 text-[11px] font-medium text-slate-600">
                <EquipIconToo className="size-4 shrink-0 sm:size-[1.15rem]" />
                {equipmentLabel}
              </p>
              <h3 className={cn("mt-3 leading-tight", uiHeadingSub)}>
                {resolvedBrandLabel}
              </h3>
              <p className="text-base font-medium text-slate-600 sm:text-lg">
                {modelDisplayToo || "—"}
              </p>
            </div>

            <div className="mt-6 space-y-0 border-t border-slate-200/80 pt-5">
              {(
                [
                  ["Patine déclarée", conditionLabel],
                  ["Contenu du lot", completenessLabelToo],
                  purchaseYear != null
                    ? ["Année d’achat", String(purchaseYear)]
                    : null,
                  equipmentSize.trim()
                    ? ["Taille / pointure", equipmentSize.trim()]
                    : null,
                  helmetAgeLabelToo
                    ? ["Âge du casque (tranche)", helmetAgeLabelToo]
                    : null,
                ] as Array<[string, string] | null>
              )
                .filter(Boolean)
                .map((row, i) => {
                  const [k, v] = row as [string, string];
                  return (
                    <div
                      key={`too-old-${k}-${i}`}
                      className="flex justify-between gap-4 border-b border-slate-100/90 py-2.5 text-sm last:border-b-0"
                    >
                      <span className="shrink-0 text-slate-400">{k}</span>
                      <span className="text-right font-medium text-slate-800">
                        {v}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </aside>
    );

    return (
      <ResultTooOldScreen
        keyboardPad={keyboardPad}
        categoryDisplayPlural={categoryDisplayPlural}
        maxAgeYears={maxAgeYears}
        onRestartEstimate={reset}
        aside={asideTooOld}
      />
    );
  };

  const renderResultFallback = () => {
    if (estimateResult?.kind !== "fallback") return null;

    const showVisualFallback =
      estimateResult.visualFallback === true &&
      Boolean(equipment && condition) &&
      brand.trim().length > 0 &&
      model.trim().length > 0;

    if (showVisualFallback && equipment) {
      const modelLine = [model.trim(), declinaison.trim()]
        .filter(Boolean)
        .join(" ")
        .trim();

      return (
        <VisualFallbackStep
          equipmentId={equipment}
          marque={resolvedBrandLabel}
          modele={modelLine}
          keyboardPad={keyboardPad}
          purchaseYear={purchaseYear}
          isSubmitting={visualFallbackBusy}
          onCalculate={async ({
            prixNeufEur,
            pickedImageUrl: visuelUrl,
            serperMarketPriceEur,
            pickedImageTitle,
          }) => {
            if (!equipment || !condition) return;
            if (purchaseYear == null) {
              setSubmitError(
                "Année d’achat manquante : revenez à l’étape « Détails » pour la renseigner."
              );
              return;
            }
            setVisualFallbackBusy(true);
            setSubmitError(null);
            try {
              const detailPayload = {
                completeness,
                ...(equipment === "casque" && helmetAgeBand && hadImpact !== null
                  ? {
                      helmetAgeBand,
                      hadImpact: hadImpact === true,
                    }
                  : {}),
                ...(equipmentSize.trim()
                  ? { equipmentSize: equipmentSize.trim() }
                  : {}),
              };
              const payload = {
                brand: brand.trim(),
                model: model.trim(),
                category: equipment,
                condition,
                purchaseYear: purchaseYear!,
                manualRetailEur: prixNeufEur,
                ...detailPayload,
                ...(equipment === "casque"
                  ? { physicalIntegrityCertified: securityChecks[3] }
                  : {}),
                ...(declinaison.trim()
                  ? { declinaison: declinaison.trim() }
                  : {}),
                ...(visuelUrl?.trim()
                  ? { pickedUrl: visuelUrl.trim() }
                  : {}),
                ...(serperMarketPriceEur != null
                  ? { serperMarketPriceEur }
                  : {}),
                ...(pickedImageTitle.trim()
                  ? { pickedImageTitle: pickedImageTitle.trim() }
                  : {}),
              };
              const validated = estimateRequestSchema.safeParse(payload);
              if (!validated.success) {
                const flat = validated.error.flatten();
                setSubmitError(
                  flat.formErrors[0] ??
                    Object.values(flat.fieldErrors).flat()[0] ??
                    "Données invalides."
                );
                return;
              }
              const res = await fetch("/api/estimate", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                body: JSON.stringify(payload),
              });
              const data: unknown = await res.json().catch(() => ({}));
              if (!res.ok) {
                const msg =
                  typeof (data as { message?: string }).message === "string"
                    ? (data as { message: string }).message
                    : "Échec du calcul.";
                setSubmitError(msg);
                return;
              }
              commitEstimateResult(data);
            } finally {
              setVisualFallbackBusy(false);
            }
          }}
        />
      );
    }

    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springTransition}
        className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-6 pb-8 text-center"
      >
        <h2 className={cn(uiHeadingCard)}>Hors parcours en ligne</h2>
        <p className={cn("mt-3 max-w-md", uiBodySm)}>
          {estimateResult.message}
        </p>
        <p className={cn("mt-4 max-w-md text-sm text-slate-500", uiBodySm)}>
          L&apos;atelier peut reprendre ce dossier manuellement. Retournez à
          l&apos;accueil ou affinez votre saisie.
        </p>
        <div
          className="mt-8 flex w-full max-w-xs flex-col gap-3"
          style={{
            paddingBottom: `max(0.75rem, env(safe-area-inset-bottom), ${keyboardPad}px)`,
          }}
        >
          <Link
            href="/"
            className={cn(
              uiBtnPrimaryBar,
              "w-full text-sm no-underline hover:text-white"
            )}
          >
            Retour à l&apos;accueil
          </Link>
          <button
            type="button"
            onClick={() => {
              setEstimateResult(null);
              setFlowPhase("form");
              setStep(1);
            }}
            className={uiLinkSubtle}
          >
            Modifier ma saisie
          </button>
        </div>
      </motion.div>
    );
  };

  const toggleSecurity = (index: 0 | 1 | 2 | 3) => {
    setSecurityChecks((prev) => {
      const next: [boolean, boolean, boolean, boolean] = [...prev];
      next[index] = !next[index];
      return next;
    });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex h-[100dvh] flex-col overflow-hidden"
      style={{
        background:
          "linear-gradient(180deg,#FFFFFF 0%,#FFFFFF 55%),radial-gradient(ellipse 85% 65% at 100% 100%, #F9F9FB 0%, transparent 58%)",
      }}
    >
      <header
        className="flex shrink-0 items-center justify-between gap-4 px-5 pt-[max(0.65rem,env(safe-area-inset-top))] sm:px-8"
      >
        <Link
          href="/"
          className="text-[17px] font-semibold tracking-tight text-slate-900 transition hover:text-emerald-800"
        >
          Re-Ride
        </Link>
        {flowPhase === "form" && (
          <span className="text-[11px] font-semibold tracking-tight text-slate-400 sm:text-xs">
            Estimation équipement
          </span>
        )}
        {flowPhase === "result" && (
          <span className="text-[11px] font-medium tracking-wide text-slate-400">
            Synthèse
          </span>
        )}
        {flowPhase === "analyzing" && (
          <span className="text-[11px] font-medium tracking-wide text-slate-400">
            Analyse
          </span>
        )}
      </header>

      <div className="px-5 pb-2 pt-0.5 sm:px-8 sm:pb-2.5">
        <div
          className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-200/65 shadow-inner ring-1 ring-slate-900/[0.04]"
          role="progressbar"
          aria-valuenow={Math.round(progressFraction * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={
            flowPhase === "form"
              ? `Progression : étape ${step} sur ${TOTAL_STEPS}`
              : flowPhase === "analyzing"
                ? "Analyse en cours"
                : "Parcours terminé"
          }
        >
          <motion.div
            layoutId="estimation-form-progress-fill"
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-600 shadow-sm"
            initial={false}
            animate={{
              width: `${Math.min(100, Math.max(0, progressFraction * 100))}%`,
            }}
            transition={{
              type: "spring",
              stiffness: 100,
              damping: 26,
              mass: 0.72,
            }}
          />
        </div>
      </div>

      <main className="relative min-h-0 flex-1 overflow-hidden">
        {flowPhase === "form" && (
          <form
            ref={formRef}
            onSubmit={handleSubmit}
            className="flex h-full min-h-0 flex-col overflow-hidden"
            noValidate
          >
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <AnimatePresence mode="wait" custom={dir}>
                <motion.div
                  key={step}
                  role="group"
                  aria-label={`Étape ${step}`}
                  custom={dir}
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={springTransition}
                  className="absolute inset-0 flex min-h-0 flex-col overflow-hidden px-5 sm:px-10"
                >
                  {/*
                    Grille auto + minmax(0,1fr) : la zone scroll a une hauteur max réelle
                    (sinon flex-1 se dilate avec le contenu et overflow-y-auto ne scroll pas sur desktop).
                  */}
                  <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden py-5 sm:py-8">
                    <div className="mx-auto grid h-full min-h-0 w-full max-w-2xl grid-rows-[auto_minmax(0,1fr)] gap-8 sm:max-w-3xl sm:gap-10">
                      <div className="w-full shrink-0">
                        <StepGuidance step={step} />
                      </div>
                      <div
                        className={cn(
                          "min-h-0 w-full overflow-y-auto overflow-x-hidden overscroll-y-contain pb-1",
                          "touch-pan-y [-webkit-overflow-scrolling:touch]"
                        )}
                      >
                  {step === 1 && (
                    <motion.div
                      className="flex w-full flex-col items-center"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.35, delay: 0.05 }}
                    >
                      <div className="grid w-full grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-5 sm:gap-6">
                        {equipmentOptions.map(({ id, icon: Icon, label: equipLabel }) => {
                          const picking = equipSelecting === id;
                          return (
                            <motion.button
                              key={id}
                              type="button"
                              aria-label={equipLabel}
                              aria-pressed={picking}
                              whileTap={{ scale: 0.97 }}
                              onClick={() => selectEquipment(id)}
                              className={cn(
                                "group relative flex min-h-[12rem] flex-col items-center justify-center gap-4 border px-2 py-5 backdrop-blur-xl sm:min-h-[14rem] sm:gap-4 sm:py-6",
                                uiCard,
                                uiCardLift,
                                "bg-white/85",
                                picking &&
                                  "border-emerald-500 bg-emerald-50/60 shadow-md ring-1 ring-emerald-500/25"
                              )}
                            >
                              {picking && (
                                <motion.span
                                  initial={{ opacity: 0, scale: 0.85 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  className="absolute right-2.5 top-2.5 sm:right-3 sm:top-3"
                                  aria-hidden
                                >
                                  <CheckCircle
                                    className="size-6 text-emerald-600 drop-shadow-sm sm:size-7"
                                    weight="fill"
                                  />
                                </motion.span>
                              )}
                              <span className="flex size-20 shrink-0 items-center justify-center sm:size-24">
                                <Icon
                                  className={cn(
                                    "size-16 shrink-0 transition-colors duration-300 sm:size-20",
                                    id === "pantalon" && "w-[4.5rem] sm:w-[5.25rem]",
                                    picking
                                      ? "text-emerald-700"
                                      : "text-slate-600 group-hover:text-slate-800"
                                  )}
                                  aria-hidden
                                />
                              </span>
                              <span
                                className={cn(
                                  "text-center text-[13px] font-semibold leading-snug tracking-tight sm:text-sm",
                                  picking
                                    ? "text-emerald-900"
                                    : "text-slate-600 group-hover:text-slate-800"
                                )}
                              >
                                {equipLabel}
                              </span>
                            </motion.button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}

                  {step === 2 && (
                    <motion.div
                      ref={brandPanelRef}
                      layout
                      transition={springTransition}
                      className="relative mx-auto flex w-full max-w-xl flex-col px-0.5 sm:max-w-2xl"
                    >
                      {brandsLoading ? (
                        <BrandsSkeleton />
                      ) : (
                        <div
                          className={cn(
                            "overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_14px_44px_-18px_rgba(15,23,42,0.28)] ring-1 ring-slate-900/[0.035]",
                            stepHint &&
                              !canGoNext &&
                              "ring-2 ring-amber-300/70 ring-offset-2 ring-offset-slate-50"
                          )}
                        >
                          <div className="flex min-h-[3.5rem] items-stretch divide-x divide-slate-100 sm:min-h-16">
                            <div className="flex w-[3.35rem] shrink-0 items-center justify-center bg-slate-50/95 sm:w-14">
                              <MagnifyingGlass
                                className="size-6 text-emerald-600"
                                weight="duotone"
                                aria-hidden
                              />
                            </div>
                            <div className="flex min-w-0 flex-1 items-center px-3 py-2.5 sm:px-4">
                              <label htmlFor="brand-search" className="sr-only">
                                Marque
                              </label>
                              <input
                                id="brand-search"
                                ref={brandSearchRef}
                                type="text"
                                value={brand}
                                onChange={(e) => {
                                  setBrand(e.target.value);
                                  setCatalogSlug(null);
                                  setBrandOpen(true);
                                }}
                                onFocus={() => setBrandOpen(true)}
                                placeholder="Marque…"
                                autoComplete="off"
                                role="combobox"
                                aria-expanded={brandOpen}
                                aria-controls="brand-command-list"
                                className="w-full min-w-0 border-0 bg-transparent text-[17px] font-medium tracking-tight text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 sm:text-lg"
                              />
                            </div>
                          </div>
                          <AnimatePresence initial={false}>
                            {brandOpen &&
                              brandChoices.length > 0 &&
                              !brandsLoading && (
                                <motion.ul
                                  id="brand-command-list"
                                  layout
                                  role="listbox"
                                  initial={{ opacity: 0, y: -12 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -10 }}
                                  transition={{
                                    type: "spring",
                                    stiffness: 380,
                                    damping: 32,
                                  }}
                                  className="max-h-[min(50svh,17.5rem)] divide-y divide-slate-100 overflow-y-auto overscroll-contain border-t border-slate-100 bg-slate-50/45"
                                >
                                  {brandChoices.map((b) => (
                                    <li
                                      key={b}
                                      role="option"
                                      aria-selected={
                                        b.toLowerCase() ===
                                        brand.trim().toLowerCase()
                                      }
                                    >
                                      <button
                                        type="button"
                                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white active:bg-emerald-50/50 sm:px-4 sm:py-3"
                                        onClick={() => {
                                          setBrand(b);
                                          setCatalogSlug(null);
                                          setBrandOpen(false);
                                          brandSearchRef.current?.blur();
                                        }}
                                      >
                                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-sm font-bold text-emerald-800 shadow-sm ring-1 ring-slate-200/70">
                                          {b.slice(0, 1).toUpperCase()}
                                        </span>
                                        <span className="truncate text-[15px] font-medium text-slate-800 sm:text-base">
                                          {b}
                                        </span>
                                      </button>
                                    </li>
                                  ))}
                                </motion.ul>
                              )}
                          </AnimatePresence>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {step === 3 && (
                    <motion.div
                      ref={modelPanelRef}
                      layout
                      transition={springTransition}
                      className="mx-auto flex w-full max-w-xl flex-col gap-5 sm:max-w-2xl"
                    >
                      <motion.div
                        layout
                        className="rounded-2xl border border-emerald-200/55 bg-emerald-50/40 px-4 py-3.5 text-center text-sm font-medium text-emerald-950"
                      >
                        Marque sélectionnée :{" "}
                        <span className="font-semibold text-emerald-900">
                          {resolvedBrandLabel || brand.trim() || "—"}
                        </span>
                      </motion.div>
                      <div
                        className={cn(
                          "overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_14px_44px_-18px_rgba(15,23,42,0.28)] ring-1 ring-slate-900/[0.035]",
                          stepHint &&
                            !canGoNext &&
                            "ring-2 ring-amber-300/70 ring-offset-2 ring-offset-slate-50"
                        )}
                      >
                        <div className="flex min-h-[3.5rem] items-stretch divide-x divide-slate-100 sm:min-h-16">
                          <div className="flex w-[3.35rem] shrink-0 items-center justify-center bg-slate-50/95 sm:w-14">
                            <Package
                              className="size-6 text-teal-600"
                              weight="duotone"
                              aria-hidden
                            />
                          </div>
                          <div className="flex min-w-0 flex-1 items-center px-3 py-2.5 sm:px-4">
                            <label htmlFor="model-search" className="sr-only">
                              Modèle
                            </label>
                            <input
                              id="model-search"
                              ref={modelInputRef}
                              type="text"
                              value={model}
                              onChange={(e) => {
                                setModel(e.target.value);
                                setCatalogSlug(null);
                                setModelOpen(true);
                              }}
                              onFocus={() => setModelOpen(true)}
                              placeholder="Modèle ou référence…"
                              autoComplete="off"
                              role="combobox"
                              aria-expanded={modelOpen}
                              aria-controls="model-command-list"
                              className="w-full min-w-0 border-0 bg-transparent text-[17px] font-medium tracking-tight text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 sm:text-lg"
                            />
                          </div>
                        </div>
                        <AnimatePresence initial={false}>
                          {modelOpen && (
                            <motion.div
                              key="model-suggest"
                              layout
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={springTransition}
                              className="border-t border-slate-100 bg-slate-50/45"
                            >
                              {modelsLoading ? (
                                <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
                                  <span className="size-12 shrink-0 animate-pulse rounded-2xl bg-slate-200/90" />
                                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                                    <span className="h-3 w-[55%] animate-pulse rounded-md bg-slate-200/85" />
                                    <span className="h-3 w-[38%] animate-pulse rounded-md bg-slate-200/65" />
                                  </div>
                                </div>
                              ) : modelSuggestions.length === 0 ? (
                                <p className="px-4 py-4 text-sm leading-relaxed text-slate-600 sm:px-5">
                                  Pas de fiche catalogue pour cette recherche.
                                  Saisissez librement : nous activerons le
                                  marché (visuels et prix neuf).
                                </p>
                              ) : (
                                <ul
                                  id="model-command-list"
                                  role="listbox"
                                  className="max-h-[min(50svh,19rem)] divide-y divide-slate-100 overflow-y-auto overscroll-contain"
                                >
                                  {modelSuggestions.map((row, idx) => {
                                    const picked =
                                      catalogSlug === row.canonical_slug;
                                    const activePick =
                                      catalogModelSelecting ===
                                      row.canonical_slug;
                                    return (
                                      <motion.li
                                        key={row.id}
                                        layout
                                        role="option"
                                        aria-selected={picked}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{
                                          type: "spring",
                                          stiffness: 400,
                                          damping: 34,
                                          delay: idx * 0.028,
                                        }}
                                      >
                                        <button
                                          type="button"
                                          className={cn(
                                            "flex w-full items-center gap-3 px-3 py-2 text-left sm:gap-3.5 sm:px-4 sm:py-2.5",
                                            picked || activePick
                                              ? "bg-emerald-50/95"
                                              : "hover:bg-white"
                                          )}
                                          onClick={() =>
                                            selectCatalogModel(row)
                                          }
                                        >
                                          <div className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200/70 sm:size-14">
                                            {row.image_url ? (
                                              // eslint-disable-next-line @next/next/no-img-element
                                              <img
                                                src={row.image_url}
                                                alt=""
                                                className="size-full object-contain"
                                              />
                                            ) : (
                                              <div className="flex size-full items-center justify-center text-[10px] font-semibold text-slate-400">
                                                —
                                              </div>
                                            )}
                                            {picked && (
                                              <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm">
                                                <Check
                                                  className="size-3"
                                                  weight="bold"
                                                />
                                              </span>
                                            )}
                                          </div>
                                          <span className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-slate-800 sm:text-base">
                                            {row.model}
                                          </span>
                                        </button>
                                      </motion.li>
                                    );
                                  })}
                                </ul>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      <label htmlFor="declinaison-field" className="sr-only">
                        Déclinaison
                      </label>
                      <input
                        id="declinaison-field"
                        type="text"
                        value={declinaison}
                        onChange={(e) => setDeclinaison(e.target.value)}
                        placeholder="Déclinaison · couleur, série… (optionnel)"
                        autoComplete="off"
                        className={cn(
                          uiInput,
                          "h-11 w-full rounded-2xl border-slate-200/90 bg-white text-[15px] sm:h-12"
                        )}
                      />
                      <div className="flex min-h-9 justify-center text-center">
                        {catalogSlug ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900 ring-1 ring-emerald-200/80">
                            <Check
                              className="size-3.5 text-emerald-600"
                              weight="bold"
                            />
                            Fiche liée — enchaînement sur la patine
                          </span>
                        ) : model.trim() ? (
                          <span className="text-xs text-slate-500">
                            Saisie libre — patine à l’étape suivante.
                          </span>
                        ) : null}
                      </div>
                    </motion.div>
                  )}

                  {step === 4 && (
                    <div className="mx-auto flex w-full max-w-xl flex-col sm:max-w-2xl">
                      <div
                        className="flex flex-col gap-4 sm:gap-5"
                        role="radiogroup"
                        aria-label="Niveau de patine du matériel"
                      >
                        {conditionOptions.map(({ id, label, help }, i) => {
                          const picking = condSelecting === id;
                          const isChosen =
                            condition === id &&
                            condSelecting === null &&
                            !picking;
                          const active = isChosen || picking;
                          return (
                            <motion.button
                              key={id}
                              type="button"
                              role="radio"
                              aria-checked={isChosen}
                              whileTap={{ scale: 0.992 }}
                              onClick={() => selectCondition(id)}
                              className={cn(
                                "group flex w-full items-start gap-3.5 rounded-3xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md sm:gap-5 sm:px-5 sm:py-4",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/20 focus-visible:ring-offset-2",
                                active
                                  ? "border-emerald-500/40 bg-emerald-50/40 shadow-md ring-1 ring-emerald-500/20"
                                  : "hover:border-slate-300",
                                picking &&
                                  "ring-2 ring-emerald-400/45 ring-offset-2 ring-offset-white"
                              )}
                            >
                              <div
                                className={cn(
                                  "flex size-11 shrink-0 items-center justify-center rounded-3xl text-sm font-semibold tabular-nums transition-all duration-200 sm:size-12 sm:rounded-[0.9rem]",
                                  active
                                    ? "bg-emerald-700 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                                    : "bg-slate-100 text-slate-500 group-hover:bg-slate-200/80"
                                )}
                                aria-hidden
                              >
                                {active ? (
                                  <Check
                                    className="size-5 sm:size-[1.35rem]"
                                    weight="bold"
                                  />
                                ) : (
                                  String(i + 1).padStart(2, "0")
                                )}
                              </div>
                              <div className="min-w-0 flex-1 pt-0.5">
                                <p className="text-[15px] font-medium leading-snug tracking-wide text-slate-800 sm:text-base">
                                  {label}
                                </p>
                                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                                  {help}
                                </p>
                              </div>
                            </motion.button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {step === 5 && (
                    <div className="mx-auto flex w-full max-w-xl flex-col sm:max-w-2xl">
                      <p className="mb-8 text-center text-sm leading-relaxed text-slate-500 sm:mb-10">
                        Ces repères affinent la fourchette au plus près du terrain.
                        <span className="mt-1 block text-xs text-slate-400">
                          « Patine marquée » inclut déjà les défauts visibles sérieux.
                        </span>
                      </p>

                      <div className="flex flex-col gap-9 sm:gap-10">
                        <div className="space-y-3" aria-labelledby="purchase-year-h">
                          <label
                            id="purchase-year-h"
                            htmlFor="purchase-year"
                            className="block text-sm font-medium text-slate-800"
                          >
                            Année d&apos;achat
                          </label>
                          <select
                            id="purchase-year"
                            value={purchaseYear ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setPurchaseYear(v === "" ? null : Number(v));
                            }}
                            className={cn(
                              uiInput,
                              "h-[3.75rem] w-full cursor-pointer appearance-none bg-white px-6 text-center text-xl font-medium tracking-tight sm:h-20 sm:px-8 sm:text-2xl",
                              stepHint &&
                                purchaseYear == null &&
                                "ring-2 ring-amber-200/80"
                            )}
                          >
                            <option value="">Choisir l&apos;année</option>
                            {purchaseYearChoices.map((y) => (
                              <option key={y} value={y}>
                                {y}
                              </option>
                            ))}
                          </select>
                          <p className="text-center text-xs leading-relaxed text-slate-500">
                            Sert à vérifier les limites de rachat pour votre sécurité.
                          </p>
                        </div>

                        {equipment === "casque" && (
                          <>
                            <div
                              className="space-y-3"
                              aria-labelledby="helmet-age-h"
                            >
                              <p
                                id="helmet-age-h"
                                className="text-sm font-medium text-slate-800"
                              >
                                Âge du casque
                              </p>
                              <div className="flex flex-col gap-1.5 rounded-3xl border border-slate-200/90 bg-slate-100/35 p-1 sm:flex-row sm:gap-1.5">
                                {HELMET_AGE_OPTIONS.map((o) => (
                                  <motion.button
                                    key={o.id}
                                    type="button"
                                    whileTap={{ scale: 0.99 }}
                                    onClick={() => setHelmetAgeBand(o.id)}
                                    className={cn(
                                      "flex-1 rounded-xl px-3 py-3 text-center text-sm font-medium transition sm:py-3.5",
                                      helmetAgeBand === o.id
                                        ? "bg-white text-slate-900 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.12)]"
                                        : "text-slate-600 hover:text-slate-900"
                                    )}
                                  >
                                    {o.label}
                                  </motion.button>
                                ))}
                              </div>
                            </div>

                            <div
                              className="space-y-3"
                              aria-labelledby="helmet-impact-h"
                            >
                              <p
                                id="helmet-impact-h"
                                className="text-sm font-medium text-slate-800"
                              >
                                Chute ou impact sur la coque
                              </p>
                              <div className="grid grid-cols-2 gap-1.5 rounded-3xl border border-slate-200/90 bg-slate-100/35 p-1">
                                {(
                                  [
                                    { v: false as const, label: "Non" },
                                    { v: true as const, label: "Oui" },
                                  ] as const
                                ).map(({ v, label }) => (
                                  <motion.button
                                    key={String(v)}
                                    type="button"
                                    whileTap={{ scale: 0.98 }}
                                    onClick={() => setHadImpact(v)}
                                    className={cn(
                                      "rounded-xl px-3 py-3.5 text-center text-sm font-semibold transition sm:py-4",
                                      hadImpact === v
                                        ? v
                                          ? "bg-amber-100 text-amber-950 shadow-sm ring-1 ring-amber-200/80"
                                          : "bg-white text-slate-900 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.12)]"
                                        : "text-slate-600 hover:bg-white/60 hover:text-slate-900"
                                    )}
                                  >
                                    {label}
                                  </motion.button>
                                ))}
                              </div>
                              {hadImpact === true && (
                                <p className="rounded-3xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-center text-xs leading-relaxed text-amber-950 sm:text-[13px]">
                                  Nous ne pouvons pas finaliser une offre en ligne
                                  pour un casque ayant subi un choc — une expertise
                                  reste possible par mail.
                                </p>
                              )}
                            </div>
                          </>
                        )}

                        <div className="space-y-3" aria-labelledby="size-h">
                          <label
                            id="size-h"
                            htmlFor="equipment-size"
                            className="block text-sm font-medium text-slate-800"
                          >
                            {equipment === "gants" || equipment === "bottes"
                              ? "Taille"
                              : "Taille ou pointure (optionnel)"}
                          </label>
                          <input
                            id="equipment-size"
                            type="text"
                            value={equipmentSize}
                            onChange={(e) =>
                              setEquipmentSize(e.target.value)
                            }
                            placeholder={
                              equipment === "casque"
                                ? "Ex. M, L, taille calotte…"
                                : equipment === "gants"
                                  ? "Ex. L, 10, taille fabricant…"
                                  : equipment === "bottes"
                                    ? "Ex. 43, US 9…"
                                    : "Ex. M, L, IT 50…"
                            }
                            autoComplete="off"
                            className={cn(
                              uiInput,
                              "h-[3.75rem] w-full px-6 text-center text-xl font-medium tracking-tight sm:h-20 sm:px-8 sm:text-2xl",
                              "placeholder:font-normal",
                              stepHint &&
                                (equipment === "gants" ||
                                  equipment === "bottes") &&
                                !equipmentSize.trim() &&
                                "ring-2 ring-amber-200/80"
                            )}
                          />
                        </div>

                        <div
                          className="space-y-3"
                          aria-labelledby="complete-h"
                        >
                          <p
                            id="complete-h"
                            className="text-sm font-medium text-slate-800"
                          >
                            Contenu transmis avec l’équipement
                          </p>
                          <div className="flex flex-col gap-2.5">
                            {COMPLETENESS_OPTIONS.map((o) => (
                              <motion.button
                                key={o.id}
                                type="button"
                                whileTap={{ scale: 0.995 }}
                                onClick={() => setCompleteness(o.id)}
                                className={cn(
                                  "flex w-full items-start gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-3.5 text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md sm:py-4",
                                  completeness === o.id
                                    ? "border-emerald-500/40 bg-emerald-50/35 shadow-md ring-1 ring-emerald-500/20"
                                    : "hover:border-slate-300"
                                )}
                              >
                                <span
                                  className={cn(
                                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg border text-[10px] font-bold",
                                    completeness === o.id
                                      ? "border-emerald-700 bg-emerald-700 text-white"
                                      : "border-slate-200 bg-slate-50 text-slate-400"
                                  )}
                                  aria-hidden
                                >
                                  {completeness === o.id ? (
                                    <Check className="size-3.5" weight="bold" />
                                  ) : null}
                                </span>
                                <span className="text-[15px] font-medium leading-snug text-slate-800 sm:text-base">
                                  {o.label}
                                </span>
                              </motion.button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {step === 6 && (
                    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 px-1">
                      {submitError && (
                        <p
                          className="w-full shrink-0 rounded-3xl border border-red-200 bg-red-50 px-3 py-2 text-center text-xs text-red-800 shadow-sm"
                          role="alert"
                        >
                          {submitError}
                        </p>
                      )}
                      {lowValue ? (
                        <div
                          className={cn(
                            uiCard,
                            uiCardLift,
                            "w-full bg-gradient-to-b from-slate-50/90 to-white px-6 py-8 text-center"
                          )}
                        >
                          <Shield
                            className="mx-auto mb-4 size-10 text-slate-300"
                            weight="regular"
                            aria-hidden
                          />
                          <p className={cn(uiBody)}>
                            Pour cette famille d’équipement, aucune case
                            supplémentaire n’est exigée : on s’appuie sur votre
                            lecture honnête du matériel.
                          </p>
                        </div>
                      ) : (
                        <div className="flex w-full flex-col gap-3.5 sm:gap-4">
                          {(
                            [
                              ...SECURITY_COPY.map((text, i) => ({
                                text,
                                index: i as 0 | 1 | 2,
                              })),
                              ...(equipment === "casque"
                                ? [
                                    {
                                      text: PHYSICAL_INTEGRITY_COPY,
                                      index: 3 as const,
                                    },
                                  ]
                                : []),
                            ] as const
                          ).map(({ text, index }) => {
                            const on = securityChecks[index];
                            return (
                              <motion.button
                                key={index}
                                type="button"
                                whileTap={{ scale: 0.992 }}
                                role="switch"
                                aria-checked={on}
                                onClick={() => toggleSecurity(index)}
                                className={cn(
                                  "group flex w-full items-center gap-3.5 rounded-3xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md sm:gap-5 sm:px-5 sm:py-4",
                                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/20 focus-visible:ring-offset-2",
                                  on
                                    ? "border-emerald-500/40 bg-emerald-50/40 shadow-md ring-1 ring-emerald-500/20"
                                    : "hover:border-slate-300"
                                )}
                              >
                                <div
                                  className={cn(
                                    "flex size-11 shrink-0 items-center justify-center rounded-3xl text-sm font-semibold tabular-nums transition-all duration-200 sm:size-12 sm:rounded-[0.9rem]",
                                    on
                                      ? "bg-emerald-700 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                                      : "bg-slate-100 text-slate-500 group-hover:bg-slate-200/80"
                                  )}
                                  aria-hidden
                                >
                                  {on ? (
                                    <Check
                                      className="size-5 sm:size-[1.35rem]"
                                      weight="bold"
                                    />
                                  ) : (
                                    String(index + 1).padStart(2, "0")
                                  )}
                                </div>
                                <span className="min-w-0 flex-1 text-[15px] font-medium leading-snug tracking-wide text-slate-800 sm:text-base">
                                  {text}
                                </span>
                                <span
                                  className={cn(
                                    "relative flex h-9 w-[3.25rem] shrink-0 items-center rounded-full px-0.5 transition-colors duration-200",
                                    on
                                      ? "bg-emerald-700"
                                      : "bg-slate-200/95 group-hover:bg-slate-300/90"
                                  )}
                                  aria-hidden
                                >
                                  <motion.span
                                    initial={false}
                                    className="block size-7 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
                                    animate={{ x: on ? 22 : 2 }}
                                    transition={{
                                      type: "spring",
                                      stiffness: 520,
                                      damping: 34,
                                    }}
                                  />
                                </span>
                              </motion.button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {stepHint && (
              <p className="shrink-0 px-5 pb-1 text-center text-xs text-amber-800">
                {stepHint}
              </p>
            )}

            {step !== 1 && (
              <footer
                className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 px-5 py-3.5 sm:px-8 sm:py-4"
                style={{
                  paddingBottom: `max(0.65rem, env(safe-area-inset-bottom), ${keyboardPad}px)`,
                }}
              >
                <button
                  type="button"
                  onClick={() => stepBack(step)}
                  className={cn(uiBtnGhostBar, "font-medium")}
                >
                  <ArrowLeft className="size-[1.125rem]" weight="regular" />
                  Retour
                </button>
                {step < TOTAL_STEPS ? (
                  <button
                    type="button"
                    onClick={tryAdvance}
                    className={uiBtnPrimaryBar}
                  >
                    Continuer
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!canSubmitEstimation}
                    className={uiBtnPrimaryBar}
                  >
                    Lancer l’analyse
                  </button>
                )}
              </footer>
            )}
          </form>
        )}

        {flowPhase === "result" && (
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            {submitError && estimateResult?.kind === "fallback" && (
              <div className="shrink-0 px-5 pt-4 sm:px-8">
                <p
                  className="rounded-3xl border border-red-200 bg-red-50 px-3 py-2.5 text-center text-xs font-medium text-red-900 shadow-sm"
                  role="alert"
                >
                  {submitError}
                </p>
              </div>
            )}
            {estimateResult?.kind === "offer" && renderResultOffer()}
            {estimateResult?.kind === "too_old" && renderResultTooOld()}
            {estimateResult?.kind === "fallback" && renderResultFallback()}
          </div>
        )}
      </main>

      <AnimatePresence>
        {flowPhase === "analyzing" && (
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="pointer-events-auto fixed inset-0 z-[110] flex flex-col items-center justify-center bg-[#FDFDFD]/92 px-4 backdrop-blur-md"
          >
            <PulsingAnalysisOrb exiting={analysisExiting} />
            <AnalysisLogLines
              lines={reassuranceLines}
              exiting={analysisExiting}
            />
            <TechnicalJournalDisclosure lines={apiStreamLog} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
