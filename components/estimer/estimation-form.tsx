"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  BetweenHorizontalStart,
  Check,
  ChevronDown,
  Footprints,
  HardHat,
  Hand,
  Package,
  Shield,
  Shirt,
} from "lucide-react";
import { filterBrands } from "@/lib/data/moto-brands";
import {
  estimateRequestSchema,
  type CompletenessId,
  type HelmetAgeBand,
} from "@/lib/validation/estimateBody";
import type { CatalogModelRow } from "@/app/api/catalog/models/route";
import { cn } from "@/lib/utils";
import { LOGISTICS_FIXED_EUR } from "@/config/business";

const TOTAL_STEPS = 6;
const ANALYSIS_MIN_VISIBLE_MS = 2000;
const PROGRESS_REVEAL_MS = 260;
const ANALYSIS_EXIT_MS = 560;
const SELECTION_FEEDBACK_MS = 300;

const BREADCRUMB_LABELS = [
  "Équipement",
  "Marque",
  "Modèle",
  "État",
  "Précisions",
  "Sécurité",
] as const;

const STEP_COPY: Record<
  number,
  { title: string; subtitle: string }
> = {
  1: {
    title: "Commençons par l’essentiel",
    subtitle:
      "Quel type d’équipement souhaitez-vous nous céder ?",
  },
  2: {
    title: "Choisissez la marque",
    subtitle:
      "Sélectionnez une marque présente dans notre catalogue pour afficher les modèles disponibles.",
  },
  3: {
    title: "Quel modèle possédez-vous ?",
    subtitle:
      "Touchez votre modèle ou utilisez la saisie manuelle si vous ne le trouvez pas.",
  },
  4: {
    title: "État de l’article",
    subtitle:
      "Choisissez l’option qui décrit le mieux l’état général — vous affinerez le reste à l’étape suivante.",
  },
  5: {
    title: "Quelques précisions",
    subtitle:
      "Taille, contenu de la vente, et pour un casque : âge et choc éventuel.",
  },
  6: {
    title: "Engagement de sécurité",
    subtitle:
      "La sécurité des motards est notre priorité. Certifiez l’intégrité de l’équipement, puis lancez l’estimation.",
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
type ConditionId =
  | "neuf-etiquette"
  | "tres-bon"
  | "bon"
  | "etat-moyen";
type FlowPhase = "form" | "analyzing" | "result";

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
};
type EstimateFallbackResult = { kind: "fallback"; message: string };
type EstimateResult = EstimateOfferResult | EstimateFallbackResult;

const equipmentOptions: { id: EquipmentId; icon: typeof HardHat }[] = [
  { id: "casque", icon: HardHat },
  { id: "blouson", icon: Shirt },
  { id: "pantalon", icon: BetweenHorizontalStart },
  { id: "gants", icon: Hand },
  { id: "bottes", icon: Footprints },
];

const conditionOptions: {
  id: ConditionId;
  label: string;
  help: string;
}[] = [
  {
    id: "neuf-etiquette",
    label: "Neuf",
    help: "Jamais porté ou utilisé, étiquettes possibles, aspect neuf.",
  },
  {
    id: "tres-bon",
    label: "Très bon",
    help: "Traces légères d’usage, aucun défaut majeur, ensemble sûr.",
  },
  {
    id: "bon",
    label: "Bon",
    help: "Usure visible mais équipement sûr, propre et fonctionnel.",
  },
  {
    id: "etat-moyen",
    label: "Moyen",
    help: "Forte usure ou défauts visibles — impact sur le prix estimé.",
  },
];

const SECURITY_COPY = [
  "Je certifie être le propriétaire légitime de l’article.",
  "Je certifie que les informations fournies reflètent l’état réel.",
  "Je comprends qu’une fausse déclaration peut invalider l’estimation.",
] as const;

const HELMET_AGE_OPTIONS: {
  id: HelmetAgeBand;
  label: string;
}[] = [
  { id: "under-2", label: "Moins de 2 ans" },
  { id: "2-to-5", label: "2 à 5 ans" },
  { id: "over-5", label: "Plus de 5 ans" },
];

const COMPLETENESS_OPTIONS: { id: CompletenessId; label: string }[] = [
  { id: "complete", label: "Complet (boîte & accessoires)" },
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
  stiffness: 380,
  damping: 28,
  mass: 0.85,
};

const stepVariants = {
  enter: (dir: number) => ({
    x: dir >= 0 ? 56 : -56,
    opacity: 0,
    scale: 0.97,
  }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (dir: number) => ({
    x: dir >= 0 ? -40 : 40,
    opacity: 0,
    scale: 0.98,
  }),
};

/** Micro-pistes visuelles + libellé court (sans fil d’Ariane chargé). */
function StepTrail({ activeStep }: { activeStep: number }) {
  const label = BREADCRUMB_LABELS[activeStep - 1];
  return (
    <div className="mb-2 flex flex-col items-center gap-2 sm:mb-3">
      <div
        className="flex items-center gap-1"
        aria-label={`Étape ${activeStep} sur ${TOTAL_STEPS}`}
      >
        {BREADCRUMB_LABELS.map((_, i) => {
          const n = i + 1;
          const done = n < activeStep;
          const here = n === activeStep;
          return (
            <React.Fragment key={i}>
              {i > 0 && (
                <span className="h-px w-2 shrink-0 bg-neutral-200 sm:w-3" />
              )}
              <span
                className={cn(
                  "size-1 rounded-full transition-colors sm:size-1.5",
                  here && "scale-125 bg-[#0a0a0a]",
                  done && !here && "bg-neutral-400",
                  !done && !here && "bg-neutral-200"
                )}
              />
            </React.Fragment>
          );
        })}
      </div>
      {label ? (
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-neutral-400">
          {label}
        </p>
      ) : null}
    </div>
  );
}

function StepGuidance({ step }: { step: number }) {
  const copy = STEP_COPY[step];
  if (!copy) return null;
  return (
    <div className="mx-auto w-full max-w-2xl px-1 text-center">
      <StepTrail activeStep={step} />
      <h2 className="text-3xl font-medium tracking-[-0.03em] text-[#0a0a0a] sm:text-4xl sm:tracking-[-0.035em]">
        {copy.title}
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-neutral-500 sm:mt-4 sm:text-lg">
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
          className="h-12 w-full animate-pulse rounded-2xl bg-neutral-100 sm:h-[3.25rem]"
        />
      ))}
    </div>
  );
}

function ModelsSkeleton() {
  return (
    <div className="grid w-full max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-2xl border border-neutral-100 bg-neutral-50/80 p-3"
        >
          <div className="aspect-square w-full animate-pulse rounded-xl bg-neutral-200/80" />
          <div className="mx-auto h-3 w-4/5 animate-pulse rounded bg-neutral-200/90" />
        </div>
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
            className="text-[13px] font-medium tracking-wide text-neutral-600"
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
        className="absolute inset-0 rounded-full bg-gradient-to-br from-[#1d5efa]/20 via-violet-400/15 to-transparent"
        animate={{ scale: [1, 1.08, 1], opacity: [0.5, 0.85, 0.5] }}
        transition={{
          duration: 2.8,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
      />
      <motion.div
        className="absolute inset-2 rounded-full border border-neutral-200/80 bg-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-md"
        animate={{ scale: [1, 1.03, 1] }}
        transition={{
          duration: 2.2,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
      />
      <motion.div
        className="relative size-16 rounded-full bg-gradient-to-br from-[#0a0a0a] to-[#2a2a2a] shadow-lg sm:size-[4.5rem]"
        style={{ boxShadow: "0 12px 40px -8px rgba(0,0,0,0.35)" }}
      />
    </motion.div>
  );
}

function TechnicalJournalDisclosure({ lines }: { lines: string[] }) {
  return (
    <details className="group mt-8 text-center">
      <summary className="cursor-pointer list-none text-[11px] font-medium tracking-[0.14em] text-neutral-400 transition hover:text-neutral-600 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-1 border-b border-neutral-300/80 pb-0.5">
          Voir le journal technique
          <ChevronDown className="size-3 transition group-open:rotate-180" />
        </span>
      </summary>
      <pre className="mx-auto mt-3 max-h-[30vh] max-w-lg overflow-hidden text-left font-mono text-[10px] leading-relaxed tracking-tight text-neutral-500">
        {lines.length ? lines.join("\n") : "—"}
      </pre>
    </details>
  );
}

export function EstimationForm() {
  useBodyScrollLock(true);
  const keyboardPad = useVisualViewportInset();

  const [step, setStep] = React.useState(1);
  const [dir, setDir] = React.useState(1);
  const [equipment, setEquipment] = React.useState<EquipmentId | null>(null);
  const [brand, setBrand] = React.useState("");
  const [model, setModel] = React.useState("");
  const [declinaison, setDeclinaison] = React.useState("");
  const [condition, setCondition] = React.useState<ConditionId | null>(null);
  const [securityChecks, setSecurityChecks] = React.useState<
    [boolean, boolean, boolean]
  >([false, false, false]);
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
  const [manualEntry, setManualEntry] = React.useState(false);
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
  const [equipSelecting, setEquipSelecting] = React.useState<EquipmentId | null>(
    null
  );
  const [condSelecting, setCondSelecting] = React.useState<ConditionId | null>(
    null
  );
  const brandBoxRef = React.useRef<HTMLDivElement>(null);
  const brandSearchRef = React.useRef<HTMLInputElement>(null);
  const modelInputRef = React.useRef<HTMLInputElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);
  const pendingResultRef = React.useRef<unknown>(null);
  const analysisStartedAtRef = React.useRef(0);
  const equipAdvanceTimerRef = React.useRef<number | null>(null);
  const condAdvanceTimerRef = React.useRef<number | null>(null);
  const modelPickTimerRef = React.useRef<number | null>(null);

  const brandSuggestions = React.useMemo(
    () => filterBrands(brand, 5),
    [brand]
  );

  const resolvedBrandLabel = React.useMemo(() => {
    const t = brand.trim().toLowerCase();
    const hit = distinctBrands.find((b) => b.toLowerCase() === t);
    return (hit ?? brand).trim();
  }, [brand, distinctBrands]);

  const brandChoices = React.useMemo(() => {
    const q = brand.trim().toLowerCase();
    if (!q) return distinctBrands.slice(0, 100);
    return distinctBrands
      .filter((b) => b.toLowerCase().includes(q))
      .slice(0, 100);
  }, [brand, distinctBrands]);

  const combinedModelValue =
    brand.trim() && model.trim()
      ? `${brand.trim()} ${model.trim()}`
      : brand.trim() || model.trim();

  const setFromCombined = (raw: string) => {
    const v = raw.trimStart();
    const end = v.length;
    let i = 0;
    while (i < end && v[i] !== " ") i++;
    const b = v.slice(0, i).trimEnd();
    const m = v.slice(i).trim();
    setBrand(b);
    setModel(m);
  };

  const commitEstimateResult = React.useCallback((data: unknown) => {
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
        });
        setFlowPhase("result");
        return;
      }
    }

    if (!success && fallback && typeof msg === "string") {
      setEstimateResult({ kind: "fallback", message: msg });
      setFlowPhase("result");
      return;
    }

    setSubmitError(msg ?? "Réponse invalide.");
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
      if (!brandBoxRef.current?.contains(e.target as Node)) setBrandOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  React.useEffect(() => {
    if (step !== 2) setBrandOpen(false);
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
    if (flowPhase !== "form" || step !== 3 || !manualEntry) return;
    const id = window.requestAnimationFrame(() => {
      modelInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [flowPhase, step, manualEntry]);

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
    if (
      step !== 3 ||
      !equipment ||
      manualEntry ||
      !resolvedBrandLabel ||
      flowPhase !== "form"
    )
      return;
    let cancelled = false;
    setModelsLoading(true);
    setCatalogModels([]);
    const q = new URLSearchParams({
      category: equipment,
      brand: resolvedBrandLabel,
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
  }, [
    step,
    equipment,
    manualEntry,
    resolvedBrandLabel,
    flowPhase,
  ]);

  React.useEffect(() => {
    if (flowPhase !== "analyzing") {
      setReassuranceLines([]);
      return;
    }
    const product =
      `${brand.trim()} ${model.trim()}`.trim() || "équipement";
    const lines = [
      `Analyse de votre ${product}…`,
      "Synchronisation avec le marché européen…",
      "Calcul de votre offre personnalisée…",
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
        setManualEntry(false);
        setCatalogModelSelecting(null);
      }
      setStep(Math.max(1, from - 1));
    },
    [clearCondAdvanceTimer, clearEquipAdvanceTimer]
  );

  const lowValue = isLowValueEquipment(equipment);

  const securityStepValid =
    lowValue || (securityChecks[0] && securityChecks[1] && securityChecks[2]);

  const canGoNext = React.useMemo(() => {
    if (step === 1) return equipment !== null;
    if (step === 2) {
      if (!brand.trim()) return false;
      if (distinctBrands.length === 0) return true;
      return distinctBrands.some(
        (b) => b.toLowerCase() === brand.trim().toLowerCase()
      );
    }
    if (step === 3) {
      if (manualEntry) return brand.trim() !== "" && model.trim() !== "";
      return catalogSlug != null && catalogSlug.length > 0;
    }
    if (step === 4) return condition !== null && equipment !== null;
    if (step === 5) {
      if (!equipment) return false;
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
    distinctBrands,
    manualEntry,
    catalogSlug,
    helmetAgeBand,
    hadImpact,
    equipmentSize,
  ]);

  const canSubmitEstimation =
    step === TOTAL_STEPS &&
    securityStepValid &&
    equipment !== null &&
    condition !== null &&
    (Boolean(catalogSlug?.length) ||
      (brand.trim().length > 0 && model.trim().length > 0));

  const tryAdvance = () => {
    setStepHint(null);
    if (step === 1 && !canGoNext) {
      setStepHint("Choisissez un type.");
      return;
    }
    if (step === 2 && !canGoNext) {
      setStepHint(
        distinctBrands.length
          ? "Choisissez une marque proposée dans la liste."
          : "Indiquez la marque de votre équipement."
      );
      return;
    }
    if (step === 3 && !canGoNext) {
      setStepHint(
        manualEntry
          ? "Indiquez la marque et le modèle (ex. Shoei NXR2)."
          : "Sélectionnez un modèle ou passez en saisie manuelle."
      );
      return;
    }
    if (step === 4 && !canGoNext) {
      setStepHint("Choisissez l’état général.");
      return;
    }
    if (step === 5 && !canGoNext) {
      if (equipment === "casque" && hadImpact === true) {
        setStepHint(
          "Un casque ayant subi un choc n’est pas éligible en ligne — contactez-nous pour une expertise."
        );
        return;
      }
      setStepHint(
        "Complétez les informations manquantes (âge casque, taille…)."
      );
      return;
    }
    if (step === 6 && !canGoNext) {
      setStepHint("Cochez les trois affirmations pour continuer.");
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
    setManualEntry(false);
    setDistinctBrands([]);
    setCatalogModels([]);
    setBrand("");
    setModel("");
    equipAdvanceTimerRef.current = window.setTimeout(() => {
      equipAdvanceTimerRef.current = null;
      setEquipSelecting(null);
      setDir(1);
      setStep(2);
      setSecurityChecks([false, false, false]);
      setHelmetAgeBand(null);
      setHadImpact(null);
      setEquipmentSize("");
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
    setManualEntry(false);
    setBrandOpen(false);
    setStepHint(null);
    setCatalogModelSelecting(row.canonical_slug);
    modelPickTimerRef.current = window.setTimeout(() => {
      modelPickTimerRef.current = null;
      setCatalogModelSelecting(null);
      setDir(1);
      setStep(4);
    }, SELECTION_FEEDBACK_MS);
  };

  const startManualModelEntry = () => {
    setManualEntry(true);
    setCatalogSlug(null);
    setModel("");
    setBrandOpen(false);
    setStepHint(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitEstimation || !equipment || !condition) return;

    const useCatalog =
      Boolean(catalogSlug?.trim()) && catalogSlug != null && !manualEntry;

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

    const payload = useCatalog
      ? {
          canonical_slug: catalogSlug.trim(),
          category: equipment,
          condition,
          ...detailPayload,
          ...(declinaison.trim() ? { declinaison: declinaison.trim() } : {}),
        }
      : {
          brand: brand.trim(),
          model: model.trim(),
          category: equipment,
          condition,
          ...detailPayload,
          ...(declinaison.trim() ? { declinaison: declinaison.trim() } : {}),
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
          prev.includes("Terminé") ? prev : [...prev, "Terminé"]
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
        prev.includes("Terminé") ? prev : [...prev, "Terminé"]
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
    setSecurityChecks([false, false, false]);
    setFlowPhase("form");
    setEstimateResult(null);
    setSubmitError(null);
    setStepHint(null);
    setApiStreamLog([]);
    setReassuranceLines([]);
    setAnalysisExiting(false);
    pendingResultRef.current = null;
    setCatalogSlug(null);
    setManualEntry(false);
    setDistinctBrands([]);
    setCatalogModels([]);
    setBrandOpen(false);
    setCatalogModelSelecting(null);
    setHelmetAgeBand(null);
    setHadImpact(null);
    setEquipmentSize("");
    setCompleteness("complete");
  };

  const equipmentLabels: Record<EquipmentId, string> = {
    casque: "Casque",
    blouson: "Blouson",
    pantalon: "Pantalon",
    gants: "Gants",
    bottes: "Bottes",
  };
  const equipmentLabel = equipment ? equipmentLabels[equipment] : "";
  const conditionLabel =
    conditionOptions.find((o) => o.id === condition)?.label ?? "";

  const progressFraction = React.useMemo(() => {
    if (flowPhase === "result") return 1;
    if (flowPhase === "analyzing") return 1;
    return step / TOTAL_STEPS;
  }, [flowPhase, step]);

  const renderResultOffer = () => {
    if (estimateResult?.kind !== "offer") return null;
    const {
      offer,
      estimatedResaleEur,
      match,
      needsReview,
      confidenceScore,
      certifiedArgusMoto,
      pricingSource,
      sourcesFound,
      retailerSource,
      isOfficialFeed,
    } = estimateResult;

    const emailBody = [
      `Prix de rachat proposé : ${offer} € (montant versé, frais et marge revente déjà pris en compte).`,
      ...(typeof estimatedResaleEur === "number" && estimatedResaleEur > 0
        ? [
            `Revente occasion indicative (marché) : env. ${estimatedResaleEur} €`,
          ]
        : []),
      `${match.brand} ${match.model}`,
      `Réf. neuf ${match.retailPrice} €`,
      `${equipmentLabel} · ${conditionLabel}`,
    ].join("\n");
    const offerEmailHref = `mailto:contact@le-coin-moto.fr?subject=${encodeURIComponent(
      `Rachat proposé — ${offer} €`
    )}&body=${encodeURIComponent(emailBody)}`;

    const recapImageUrl = catalogSlug
      ? (catalogModels.find((r) => r.canonical_slug === catalogSlug)
          ?.image_url ?? null)
      : null;
    const EquipIcon = equipment
      ? (equipmentOptions.find((e) => e.id === equipment)?.icon ?? HardHat)
      : HardHat;
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

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springTransition}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden"
      >
        <div
          className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-10 px-5 pb-8 pt-6 sm:gap-12 sm:pb-10 sm:pt-8 lg:grid-cols-12 lg:items-start lg:gap-14"
          style={{
            paddingBottom: `max(2rem, env(safe-area-inset-bottom), ${keyboardPad}px)`,
          }}
        >
          {/* Colonne estimation */}
          <div className="flex flex-col lg:col-span-7">
            <div className="flex flex-col gap-4 text-center lg:max-w-xl lg:text-left">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-400">
                Estimation terminée
              </p>
              <h2 className="text-3xl font-semibold tracking-[-0.03em] text-[#0a0a0a] sm:text-4xl">
                Prix de rachat proposé
              </h2>
              <p className="text-base leading-relaxed text-neutral-600 sm:text-[17px]">
                Montant que nous vous versons pour cet article, dans l’état
                indiqué. Il inclut nos frais de contrôle et de logistique, ainsi
                que la marge nécessaire pour une revente sereine — un équilibre
                juste pour vous comme pour nous.
              </p>
              <p className="text-sm leading-snug text-neutral-500">
                Indicatif, valable 7 jours. Paiement sous 48 h après réception et
                vérification.
              </p>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
              {certifiedArgusMoto && (
                <span
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em]",
                    "border border-[#1d5efa]/25 bg-gradient-to-r from-[#1d5efa]/8 to-amber-500/15 text-[#1746cf]"
                  )}
                >
                  Certifié Argus
                </span>
              )}
            </div>

            <div className="mt-6 flex flex-col items-center lg:items-start">
              <p
                className="text-7xl font-semibold tracking-[-0.04em] text-[#0a0a0a] tabular-nums sm:text-8xl lg:text-[7.5rem] lg:leading-[0.95]"
                aria-label={`Montant que nous vous versons : ${offer} euros`}
              >
                {offer}
                <span className="text-3xl font-medium text-neutral-300 sm:text-4xl lg:text-5xl">
                  {" "}
                  €
                </span>
              </p>
              <p className="mt-2 text-xs font-medium uppercase tracking-[0.14em] text-neutral-400">
                versés à vous · tout compris
              </p>
            </div>

            {typeof estimatedResaleEur === "number" && estimatedResaleEur > 0 ? (
              <div
                className={cn(
                  "mx-auto mt-8 w-full max-w-md rounded-2xl border border-emerald-200/70",
                  "bg-gradient-to-br from-emerald-50/95 via-white to-teal-50/30",
                  "px-5 py-5 text-center shadow-[0_12px_36px_-20px_rgba(5,150,105,0.35)]",
                  "lg:mx-0 lg:text-left"
                )}
              >
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-800/75">
                  Revente occasion — ordre de grandeur
                </p>
                <p className="mt-2 text-4xl font-semibold tabular-nums tracking-tight text-emerald-950 sm:text-5xl">
                  ~{estimatedResaleEur}
                  <span className="text-2xl font-medium text-emerald-700/55 sm:text-3xl">
                    {" "}
                    €
                  </span>
                </p>
                <p className="mt-1 text-xs font-medium text-emerald-800/70">
                  indicatif marché
                </p>
                <p className="mt-3 text-sm leading-relaxed text-emerald-950/85">
                  C’est le niveau de prix auquel nous pouvons typiquement
                  repositionner un équivalent sur l’occasion après la reprise —
                  avant négociation avec le prochain acheteur. Cela explique
                  l’écart avec le montant que nous vous payons aujourd’hui.
                </p>
              </div>
            ) : null}

            <p className="mx-auto mt-6 max-w-md text-center text-sm leading-relaxed text-neutral-500 lg:mx-0 lg:text-left">
              Basé sur une référence neuf à{" "}
              <span className="font-medium text-neutral-700">{retailFmt}</span>.
              Nos frais (dont env. {LOGISTICS_FIXED_EUR} € logistique et
              traitement) sont déjà déduits de ce montant.
            </p>

            <div className="mx-auto mt-6 flex w-full max-w-md flex-col gap-2.5 lg:mx-0">
              {isOfficialFeed && (
                <p className="rounded-2xl border border-blue-100/90 bg-blue-50/60 px-4 py-3 text-xs leading-relaxed tracking-wide text-blue-950">
                  Cote {retailerSource ?? "Data Lake"} ·{" "}
                  {Math.max(1, sourcesFound ?? 1)} sources
                </p>
              )}
              {pricingSource === "argus_predictif" && (
                <p className="rounded-2xl border border-violet-100/90 bg-violet-50/60 px-4 py-3 text-xs tracking-wide text-violet-950">
                  Estimation prédictive (marché live indisponible)
                </p>
              )}
              {needsReview && (
                <p className="rounded-2xl border border-amber-100/90 bg-amber-50/80 px-4 py-3 text-xs tracking-wide text-amber-950">
                  Reprise à confirmer
                  {typeof confidenceScore === "number"
                    ? ` · ${Math.round(confidenceScore)} %`
                    : ""}
                </p>
              )}
              {typeof confidenceScore === "number" && confidenceScore < 70 && (
                <p className="rounded-2xl border border-neutral-200/90 bg-neutral-50 px-4 py-3 text-xs tracking-wide text-neutral-700">
                  Échantillon restreint — validation manuelle recommandée
                </p>
              )}
            </div>

            <p className="mx-auto mt-6 text-center text-xs leading-relaxed text-neutral-400 lg:mx-0 lg:text-left">
              Satisfait ou retour gratuit de votre équipement.
            </p>

            <div className="mx-auto mt-8 flex w-full max-w-md flex-col gap-4 lg:mx-0">
              <a
                href={offerEmailHref}
                className={cn(
                  "group relative flex h-14 w-full items-center justify-center overflow-hidden rounded-full bg-[#0a0a0a] text-[15px] font-semibold tracking-wide text-white no-underline",
                  "shadow-[0_12px_40px_-12px_rgba(0,0,0,0.5)] transition hover:bg-[#151515]"
                )}
              >
                <span
                  className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-0 transition duration-700 ease-out group-hover:translate-x-full group-hover:opacity-100"
                  aria-hidden
                />
                <span className="relative z-[1]">
                  Demander ce rachat à {offer} €
                </span>
              </a>
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start lg:gap-6">
                <a
                  href={offerEmailHref}
                  className="text-sm font-medium text-[#0a0a0a] underline decoration-neutral-400 underline-offset-4 transition hover:decoration-[#0a0a0a]"
                >
                  Ouvrir l’e-mail
                </a>
                <button
                  type="button"
                  onClick={reset}
                  className="text-sm tracking-wide text-neutral-400 transition hover:text-neutral-700"
                >
                  Nouvelle estimation
                </button>
              </div>
            </div>
          </div>

          {/* Carte rappel produit */}
          <aside className="lg:col-span-5">
            <div
              className={cn(
                "relative overflow-hidden rounded-[1.65rem] border border-neutral-200/80",
                "bg-gradient-to-b from-white via-neutral-50/40 to-white",
                "shadow-[0_28px_64px_-28px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.04]",
                "lg:sticky lg:top-6"
              )}
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-neutral-300/60 to-transparent" />
              <div className="p-6 sm:p-7">
                <div className="flex items-center gap-2 text-neutral-500">
                  <Package
                    className="size-4 shrink-0 opacity-70"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <span className="text-[11px] font-medium uppercase tracking-[0.16em]">
                    Votre article
                  </span>
                </div>

                <div className="relative mx-auto mt-5 aspect-[4/3] w-full max-w-[280px] overflow-hidden rounded-2xl bg-neutral-100 sm:max-w-none">
                  {recapImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={recapImageUrl}
                      alt=""
                      className="size-full object-contain mix-blend-multiply"
                    />
                  ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-neutral-100 via-neutral-50 to-neutral-200/60">
                      <EquipIcon
                        className="size-16 text-neutral-300"
                        strokeWidth={1}
                        aria-hidden
                      />
                      <span className="px-4 text-center text-xs font-medium text-neutral-400">
                        Visuel indicatif
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-6 space-y-1 text-center sm:mt-7">
                  <p className="inline-flex items-center justify-center gap-1.5 rounded-full border border-neutral-200/90 bg-white/80 px-3 py-1 text-[11px] font-medium text-neutral-600">
                    <EquipIcon className="size-3.5" strokeWidth={1.75} />
                    {equipmentLabel}
                  </p>
                  <h3 className="mt-3 text-xl font-semibold leading-tight tracking-tight text-[#0a0a0a] sm:text-2xl">
                    {match.brand}
                  </h3>
                  <p className="text-base font-medium text-neutral-600 sm:text-lg">
                    {match.model}
                  </p>
                  {declinaison.trim() ? (
                    <p className="text-sm text-neutral-500">
                      {declinaison.trim()}
                    </p>
                  ) : null}
                </div>

                <div className="mt-6 space-y-0 border-t border-neutral-200/80 pt-5">
                  {[
                    ["État déclaré", conditionLabel],
                    ["Colis", completenessLabel],
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
                          className="flex justify-between gap-4 border-b border-neutral-100/90 py-2.5 text-sm last:border-b-0"
                        >
                          <span className="shrink-0 text-neutral-400">{k}</span>
                          <span className="text-right font-medium text-neutral-800">
                            {v}
                          </span>
                        </div>
                      );
                    })}
                </div>

                <div className="mt-5 rounded-xl bg-neutral-900/[0.03] px-4 py-3 text-center">
                  <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-400">
                    Référence prix neuf
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-[#0a0a0a]">
                    {retailFmt}
                  </p>
                </div>

                {typeof estimatedResaleEur === "number" &&
                estimatedResaleEur > 0 ? (
                  <div className="mt-3 rounded-xl border border-emerald-100/90 bg-emerald-50/55 px-4 py-3 text-center">
                    <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-emerald-800/65">
                      Revente occasion (indicatif)
                    </p>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-950">
                      ~{estimatedResaleEur} €
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      </motion.div>
    );
  };

  const renderResultFallback = () => {
    if (estimateResult?.kind !== "fallback") return null;
    const expertiseBody = `Cat : ${equipmentLabel}\nRéf : ${[brand, model, declinaison].filter(Boolean).join(" ")}\nÉtat : ${conditionLabel}`;
    const expertiseHref = `mailto:expertise@le-coin-moto.fr?subject=${encodeURIComponent("Expertise")}&body=${encodeURIComponent(expertiseBody)}`;
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springTransition}
        className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-6 pb-8 text-center"
      >
        <h2 className="text-lg font-semibold tracking-tight text-[#0a0a0a]">
          Hors automate
        </h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-neutral-500">
          {estimateResult.message}
        </p>
        <div
          className="mt-8 flex w-full max-w-xs flex-col gap-3"
          style={{
            paddingBottom: `max(0.75rem, env(safe-area-inset-bottom), ${keyboardPad}px)`,
          }}
        >
          <a
            href={expertiseHref}
            className="inline-flex h-12 items-center justify-center rounded-full bg-[#0a0a0a] text-sm font-semibold text-white"
          >
            Expertise manuelle
          </a>
          <button
            type="button"
            onClick={() => {
              setEstimateResult(null);
              setFlowPhase("form");
              setStep(1);
            }}
            className="text-sm text-neutral-500 underline underline-offset-4"
          >
            Modifier
          </button>
        </div>
      </motion.div>
    );
  };

  const toggleSecurity = (index: 0 | 1 | 2) => {
    setSecurityChecks((prev) => {
      const next: [boolean, boolean, boolean] = [...prev];
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
          className="text-[17px] font-semibold tracking-tight text-[#0a0a0a] transition hover:text-neutral-600"
        >
          Re-Ride
        </Link>
        {flowPhase === "form" && (
          <span className="tabular-nums text-xs font-medium tracking-wide text-neutral-400 sm:text-sm">
            {step}/{TOTAL_STEPS}
          </span>
        )}
        {flowPhase === "result" && (
          <span className="text-[11px] font-medium tracking-wide text-neutral-400">
            Résultat
          </span>
        )}
        {flowPhase === "analyzing" && (
          <span className="text-[11px] font-medium tracking-wide text-neutral-400">
            Analyse
          </span>
        )}
      </header>

      <div className="h-[2px] w-full shrink-0 overflow-hidden bg-neutral-100">
        <motion.div
          className="h-full bg-[#0a0a0a]"
          initial={false}
          animate={{ width: `${Math.min(100, Math.max(0, progressFraction * 100))}%` }}
          transition={{
            type: "spring",
            stiffness: 120,
            damping: 24,
            mass: 0.65,
          }}
        />
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
                  <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden py-4 sm:py-6">
                    <div className="mx-auto grid h-full min-h-0 w-full max-w-2xl grid-rows-[auto_minmax(0,1fr)] gap-6 sm:max-w-3xl sm:gap-7">
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
                    <div className="flex w-full flex-col items-center">
                      <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5 sm:gap-5">
                        {equipmentOptions.map(({ id, icon: Icon }) => {
                          const picking = equipSelecting === id;
                          return (
                            <motion.button
                              key={id}
                              type="button"
                              whileTap={{ scale: 0.96 }}
                              onClick={() => selectEquipment(id)}
                              className={cn(
                                "relative aspect-square rounded-3xl border-2 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors duration-200",
                                picking
                                  ? "border-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]"
                                  : "border-neutral-200/80 hover:border-neutral-300"
                              )}
                            >
                              {picking && (
                                <span className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm">
                                  <Check className="size-4" strokeWidth={2.5} />
                                </span>
                              )}
                              <span className="flex h-full w-full items-center justify-center text-neutral-400">
                                <Icon
                                  className="size-11 sm:size-[3.25rem]"
                                  strokeWidth={1.1}
                                />
                              </span>
                            </motion.button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {step === 2 && (
                    <div
                      ref={brandBoxRef}
                      className="flex w-full flex-col items-center"
                    >
                      {brandsLoading ? (
                        <BrandsSkeleton />
                      ) : (
                        <div className="relative w-full max-w-xl">
                          <label htmlFor="brand-search" className="sr-only">
                            Rechercher une marque
                          </label>
                          <input
                            id="brand-search"
                            ref={brandSearchRef}
                            type="text"
                            value={brand}
                            onChange={(e) => {
                              setBrand(e.target.value);
                              setBrandOpen(true);
                            }}
                            onFocus={() => setBrandOpen(true)}
                            placeholder="Ex. Shoei, Arai…"
                            autoComplete="off"
                            role="combobox"
                            aria-expanded={brandOpen}
                            aria-controls="brand-command-list"
                            className={cn(
                              "h-[3.75rem] w-full rounded-3xl border border-neutral-200/95 bg-white px-6 sm:h-20 sm:px-8",
                              "text-xl font-medium tracking-tight text-[#0a0a0a] shadow-[0_2px_16px_-6px_rgba(0,0,0,0.08)] outline-none sm:text-2xl",
                              "placeholder:text-neutral-400 placeholder:font-normal",
                              "transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/8",
                              stepHint &&
                                !canGoNext &&
                                step === 2 &&
                                "ring-2 ring-amber-200/80"
                            )}
                          />
                          {brandOpen &&
                            brandChoices.length > 0 &&
                            !brandsLoading && (
                              <ul
                                id="brand-command-list"
                                role="listbox"
                                className="absolute left-0 right-0 top-full z-10 mt-2 max-h-[min(50vh,22rem)] overflow-auto rounded-2xl border border-neutral-200/90 bg-white py-1 shadow-lg"
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
                                      className="w-full px-6 py-3.5 text-left text-base font-medium tracking-tight text-neutral-800 hover:bg-neutral-50"
                                      onClick={() => {
                                        setBrand(b);
                                        setBrandOpen(false);
                                        brandSearchRef.current?.blur();
                                      }}
                                    >
                                      {b}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                        </div>
                      )}
                    </div>
                  )}

                  {step === 3 && (
                    <div className="flex w-full min-h-0 flex-col items-center gap-6 touch-pan-y">
                      {!manualEntry ? (
                        <>
                          {modelsLoading ? (
                            <ModelsSkeleton />
                          ) : catalogModels.length === 0 ? (
                            <p className="max-w-md text-center text-sm leading-relaxed text-neutral-500">
                              Aucun modèle indexé pour cette marque. Nous
                              complétons le catalogue régulièrement — en attendant,
                              utilisez la saisie manuelle.
                            </p>
                          ) : (
                            <div className="grid w-full max-w-3xl grid-cols-2 gap-3 touch-pan-y sm:grid-cols-3 sm:gap-4">
                              {catalogModels.map((row) => {
                                const picked =
                                  catalogModelSelecting === row.canonical_slug;
                                return (
                                  <motion.button
                                    key={row.id}
                                    type="button"
                                    whileTap={{ scale: 0.98 }}
                                    onClick={() => selectCatalogModel(row)}
                                    className={cn(
                                      "touch-pan-y flex flex-col gap-2 rounded-2xl border-2 bg-white p-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors",
                                      picked
                                        ? "border-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]"
                                        : "border-neutral-200/80 hover:border-neutral-300"
                                    )}
                                  >
                                    <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-neutral-50">
                                      {row.image_url ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          src={row.image_url}
                                          alt=""
                                          className="size-full object-contain"
                                        />
                                      ) : (
                                        <div className="flex size-full items-center justify-center text-[10px] font-medium uppercase tracking-wider text-neutral-400">
                                          Photo
                                        </div>
                                      )}
                                      {picked && (
                                        <span className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm">
                                          <Check
                                            className="size-4"
                                            strokeWidth={2.5}
                                          />
                                        </span>
                                      )}
                                    </div>
                                    <span className="line-clamp-2 text-center text-[13px] font-medium leading-snug tracking-tight text-neutral-800 sm:text-sm">
                                      {row.model}
                                    </span>
                                  </motion.button>
                                );
                              })}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={startManualModelEntry}
                            className="text-sm font-medium tracking-wide text-neutral-500 underline decoration-neutral-300 underline-offset-4 transition hover:text-[#0a0a0a] hover:decoration-[#0a0a0a]"
                          >
                            Saisie manuelle (marque + modèle)
                          </button>
                        </>
                      ) : (
                        <div className="flex w-full flex-col items-center">
                          <p className="mb-4 max-w-md text-center text-sm text-neutral-500">
                            Décrivez la référence : nos experts alignent sur le
                            catalogue lorsque c’est possible.
                          </p>
                          <div className="relative w-full max-w-xl">
                            <input
                              ref={modelInputRef}
                              type="text"
                              value={combinedModelValue}
                              onChange={(e) => {
                                setFromCombined(e.target.value);
                                setBrandOpen(true);
                              }}
                              onFocus={() => setBrandOpen(true)}
                              placeholder="Marque et modèle · ex. Shoei NXR2"
                              autoComplete="off"
                              className={cn(
                                "h-[3.75rem] w-full rounded-3xl border border-neutral-200/95 bg-white px-6 sm:h-20 sm:px-8",
                                "text-xl font-medium tracking-tight text-[#0a0a0a] shadow-[0_2px_16px_-6px_rgba(0,0,0,0.08)] outline-none sm:text-2xl",
                                "placeholder:text-neutral-400 placeholder:font-normal",
                                "transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/8",
                                stepHint &&
                                  (!brand.trim() || !model.trim()) &&
                                  "ring-2 ring-amber-200/80"
                              )}
                            />
                            {brandOpen && brandSuggestions.length > 0 && (
                              <ul className="absolute left-0 right-0 top-full z-10 mt-2 max-h-[min(50vh,22rem)] overflow-y-auto rounded-2xl border border-neutral-200/90 bg-white py-1 shadow-lg">
                                {brandSuggestions.map((b) => (
                                  <li key={b}>
                                    <button
                                      type="button"
                                      className="w-full px-6 py-3.5 text-left text-base font-medium tracking-tight text-neutral-800 hover:bg-neutral-50"
                                      onClick={() => {
                                        const rest = model.trim();
                                        setBrand(b);
                                        setModel(rest);
                                        setBrandOpen(false);
                                        modelInputRef.current?.focus();
                                      }}
                                    >
                                      {b}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <input
                            type="text"
                            value={declinaison}
                            onChange={(e) => setDeclinaison(e.target.value)}
                            placeholder="Déclinaison (optionnel)"
                            className="mt-5 h-12 w-full max-w-xl rounded-2xl border border-transparent bg-transparent text-center text-base tracking-wide text-neutral-500 outline-none placeholder:text-neutral-400 focus:border-neutral-200 sm:mt-6"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setManualEntry(false);
                              setBrandOpen(false);
                              setModel("");
                              setCatalogSlug(null);
                            }}
                            className="mt-4 text-sm font-medium text-neutral-500 underline underline-offset-4 hover:text-[#0a0a0a]"
                          >
                            Retour à la liste catalogue
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {step === 4 && (
                    <div className="mx-auto flex w-full max-w-xl flex-col sm:max-w-2xl">
                      <div
                        className="flex flex-col gap-3 sm:gap-3.5"
                        role="radiogroup"
                        aria-label="État général de l’article"
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
                                "group flex w-full items-start gap-3.5 rounded-2xl border px-4 py-4 text-left shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)] transition-all duration-200 sm:gap-5 sm:rounded-3xl sm:px-5 sm:py-4",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a0a0a]/15 focus-visible:ring-offset-2",
                                active
                                  ? "border-[#0a0a0a]/20 bg-gradient-to-br from-white to-neutral-50/90 shadow-[0_8px_28px_-12px_rgba(0,0,0,0.14)] ring-1 ring-[#0a0a0a]/5"
                                  : "border-neutral-200/90 bg-white/90 hover:border-neutral-300/95 hover:bg-white hover:shadow-[0_6px_20px_-10px_rgba(0,0,0,0.1)]",
                                picking &&
                                  "ring-2 ring-emerald-400/45 ring-offset-2 ring-offset-white"
                              )}
                            >
                              <div
                                className={cn(
                                  "flex size-11 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold tabular-nums transition-all duration-200 sm:size-12 sm:rounded-[0.9rem]",
                                  active
                                    ? "bg-[#0a0a0a] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                                    : "bg-neutral-100 text-neutral-500 group-hover:bg-neutral-200/80"
                                )}
                                aria-hidden
                              >
                                {active ? (
                                  <Check
                                    className="size-5 sm:size-[1.35rem]"
                                    strokeWidth={2.5}
                                  />
                                ) : (
                                  String(i + 1).padStart(2, "0")
                                )}
                              </div>
                              <div className="min-w-0 flex-1 pt-0.5">
                                <p className="text-[15px] font-medium leading-snug tracking-wide text-neutral-800 sm:text-base">
                                  {label}
                                </p>
                                <p className="mt-1.5 text-sm leading-relaxed text-neutral-500">
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
                      <p className="mb-8 text-center text-sm leading-relaxed text-neutral-500 sm:mb-10">
                        Ces infos permettent d’ajuster le prix au plus juste.
                        <span className="mt-1 block text-xs text-neutral-400">
                          « Moyen » couvre déjà les défauts visibles importants.
                        </span>
                      </p>

                      <div className="flex flex-col gap-9 sm:gap-10">
                        {equipment === "casque" && (
                          <>
                            <div
                              className="space-y-3"
                              aria-labelledby="helmet-age-h"
                            >
                              <p
                                id="helmet-age-h"
                                className="text-sm font-medium text-neutral-800"
                              >
                                Âge du casque
                              </p>
                              <div className="flex flex-col gap-1.5 rounded-2xl border border-neutral-200/90 bg-neutral-100/35 p-1 sm:flex-row sm:gap-1.5">
                                {HELMET_AGE_OPTIONS.map((o) => (
                                  <motion.button
                                    key={o.id}
                                    type="button"
                                    whileTap={{ scale: 0.99 }}
                                    onClick={() => setHelmetAgeBand(o.id)}
                                    className={cn(
                                      "flex-1 rounded-xl px-3 py-3 text-center text-sm font-medium transition sm:py-3.5",
                                      helmetAgeBand === o.id
                                        ? "bg-white text-[#0a0a0a] shadow-[0_2px_12px_-4px_rgba(0,0,0,0.12)]"
                                        : "text-neutral-600 hover:text-neutral-900"
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
                                className="text-sm font-medium text-neutral-800"
                              >
                                Chute ou impact sur la coque
                              </p>
                              <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-neutral-200/90 bg-neutral-100/35 p-1">
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
                                          : "bg-white text-[#0a0a0a] shadow-[0_2px_12px_-4px_rgba(0,0,0,0.12)]"
                                        : "text-neutral-600 hover:bg-white/60 hover:text-neutral-900"
                                    )}
                                  >
                                    {label}
                                  </motion.button>
                                ))}
                              </div>
                              {hadImpact === true && (
                                <p className="rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-center text-xs leading-relaxed text-amber-950 sm:text-[13px]">
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
                            className="block text-sm font-medium text-neutral-800"
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
                              "h-[3.75rem] w-full rounded-3xl border border-neutral-200/95 bg-white px-6 text-center text-xl font-medium tracking-tight text-[#0a0a0a] shadow-[0_2px_16px_-6px_rgba(0,0,0,0.08)] outline-none sm:h-20 sm:px-8 sm:text-2xl",
                              "placeholder:text-neutral-400 placeholder:font-normal",
                              "transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/8",
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
                            className="text-sm font-medium text-neutral-800"
                          >
                            Contenu de la vente
                          </p>
                          <div className="flex flex-col gap-2.5">
                            {COMPLETENESS_OPTIONS.map((o) => (
                              <motion.button
                                key={o.id}
                                type="button"
                                whileTap={{ scale: 0.995 }}
                                onClick={() => setCompleteness(o.id)}
                                className={cn(
                                  "flex w-full items-start gap-3 rounded-2xl border px-4 py-3.5 text-left shadow-[0_2px_12px_-4px_rgba(0,0,0,0.05)] transition sm:rounded-3xl sm:py-4",
                                  completeness === o.id
                                    ? "border-[#0a0a0a]/20 bg-gradient-to-br from-white to-neutral-50/90 ring-1 ring-[#0a0a0a]/5"
                                    : "border-neutral-200/90 bg-white/90 hover:border-neutral-300"
                                )}
                              >
                                <span
                                  className={cn(
                                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg border text-[10px] font-bold",
                                    completeness === o.id
                                      ? "border-[#0a0a0a] bg-[#0a0a0a] text-white"
                                      : "border-neutral-200 bg-neutral-50 text-neutral-400"
                                  )}
                                  aria-hidden
                                >
                                  {completeness === o.id ? (
                                    <Check
                                      className="size-3.5"
                                      strokeWidth={2.5}
                                    />
                                  ) : null}
                                </span>
                                <span className="text-[15px] font-medium leading-snug text-neutral-800 sm:text-base">
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
                          className="w-full shrink-0 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-center text-xs text-red-800"
                          role="alert"
                        >
                          {submitError}
                        </p>
                      )}
                      {lowValue ? (
                        <div className="w-full rounded-3xl border border-neutral-200/80 bg-gradient-to-b from-neutral-50/90 to-white px-6 py-8 text-center shadow-[0_4px_24px_-8px_rgba(0,0,0,0.06)]">
                          <Shield
                            className="mx-auto mb-4 size-10 text-neutral-300"
                            strokeWidth={1.25}
                            aria-hidden
                          />
                          <p className="text-base leading-relaxed text-neutral-600">
                            Pour cette catégorie, aucune déclaration additionnelle
                            n’est requise au-delà de votre honnêteté habituelle.
                          </p>
                        </div>
                      ) : (
                        <div className="flex w-full flex-col gap-3.5 sm:gap-4">
                          {SECURITY_COPY.map((text, i) => {
                            const on = securityChecks[i];
                            return (
                              <motion.button
                                key={i}
                                type="button"
                                whileTap={{ scale: 0.992 }}
                                role="switch"
                                aria-checked={on}
                                onClick={() => toggleSecurity(i as 0 | 1 | 2)}
                                className={cn(
                                  "group flex w-full items-center gap-3.5 rounded-2xl border px-4 py-4 text-left shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)] transition-all duration-200 sm:gap-5 sm:rounded-3xl sm:px-5 sm:py-4",
                                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a0a0a]/15 focus-visible:ring-offset-2",
                                  on
                                    ? "border-[#0a0a0a]/20 bg-gradient-to-br from-white to-neutral-50/90 shadow-[0_8px_28px_-12px_rgba(0,0,0,0.14)] ring-1 ring-[#0a0a0a]/5"
                                    : "border-neutral-200/90 bg-white/90 hover:border-neutral-300/95 hover:bg-white hover:shadow-[0_6px_20px_-10px_rgba(0,0,0,0.1)]"
                                )}
                              >
                                <div
                                  className={cn(
                                    "flex size-11 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold tabular-nums transition-all duration-200 sm:size-12 sm:rounded-[0.9rem]",
                                    on
                                      ? "bg-[#0a0a0a] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                                      : "bg-neutral-100 text-neutral-500 group-hover:bg-neutral-200/80"
                                  )}
                                  aria-hidden
                                >
                                  {on ? (
                                    <Check
                                      className="size-5 sm:size-[1.35rem]"
                                      strokeWidth={2.5}
                                    />
                                  ) : (
                                    String(i + 1).padStart(2, "0")
                                  )}
                                </div>
                                <span className="min-w-0 flex-1 text-[15px] font-medium leading-snug tracking-wide text-neutral-800 sm:text-base">
                                  {text}
                                </span>
                                <span
                                  className={cn(
                                    "relative flex h-9 w-[3.25rem] shrink-0 items-center rounded-full px-0.5 transition-colors duration-200",
                                    on
                                      ? "bg-[#0a0a0a]"
                                      : "bg-neutral-200/95 group-hover:bg-neutral-300/90"
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
                className="flex shrink-0 items-center justify-between gap-3 border-t border-neutral-100/90 px-5 py-3.5 sm:px-8 sm:py-4"
                style={{
                  paddingBottom: `max(0.65rem, env(safe-area-inset-bottom), ${keyboardPad}px)`,
                }}
              >
                <button
                  type="button"
                  onClick={() => stepBack(step)}
                  className="inline-flex h-12 items-center gap-2 rounded-full px-4 text-base font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-[#0a0a0a]"
                >
                  <ArrowLeft className="size-[1.125rem]" strokeWidth={1.5} />
                  Retour
                </button>
                {step < TOTAL_STEPS ? (
                  <button
                    type="button"
                    onClick={tryAdvance}
                    className="h-12 rounded-full bg-[#0a0a0a] px-9 text-base font-semibold tracking-wide text-white shadow-md transition hover:bg-neutral-800 sm:h-[3.25rem] sm:px-10"
                  >
                    Continuer
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!canSubmitEstimation}
                    className="h-12 rounded-full bg-[#0a0a0a] px-9 text-base font-semibold tracking-wide text-white shadow-md transition hover:bg-neutral-800 disabled:opacity-40 sm:h-[3.25rem] sm:px-10"
                  >
                    Obtenir le prix
                  </button>
                )}
              </footer>
            )}
          </form>
        )}

        {flowPhase === "result" && (
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            {estimateResult?.kind === "offer" && renderResultOffer()}
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
