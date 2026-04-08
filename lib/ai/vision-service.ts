/**
 * Filtre vision local (CLIP via Transformers.js) : pertinence par famille d’équipement,
 * zero-shot « vue complète » vs « gros plan / accessoire », forme, dédoublonnage embedding.
 */

import type { SerperEquipmentCategory } from "@/lib/serper/partner-image-search";
import { getClipPromptTriplet } from "@/lib/serper/partner-image-search";

const CLIP_MODEL_ID = "Xenova/clip-vit-base-patch32";

/** Seuil de similarité cosinus (image vs texte « relevance ») pour garder l’image. */
const MIN_MOTORCYCLE_COSINE = 0.2;
/**
 * Au-delà de ce cosinus entre deux images, on considère un doublon visuel.
 * Plus bas = plus strict (évite 2–3× la même veste légèrement recadrée).
 */
const DEDUPLICATE_COSINE_MIN = 0.88;

/** Rejeter comme « gros plan » seulement si cos(close-up) > cos(full) + marge. */
const CLOSE_UP_SCORE_MARGIN_DEFAULT = 0.15;

/** Après filtre strict : si moins de ce nombre d’images, réintègre les refus « gros plan » seuls. */
const MIN_OUTPUT_BEFORE_CLOSEUP_RELAX = 2;

/** Ratio L/H : hors plage = trop panoramique ou trop étroit. */
const ASPECT_MIN = 0.5;
const ASPECT_MAX = 1.5;

type RawImageType = typeof import("@xenova/transformers").RawImage;

type LoadedClip = {
  processor: (image: unknown) => Promise<unknown>;
  visionModel: (inputs: unknown) => Promise<{ image_embeds: { data: Float32Array } }>;
  tokenizer: {
    (texts: string[], opts: { padding: boolean; truncation: boolean }): unknown;
  };
  textModel: (inputs: unknown) => Promise<{ text_embeds: { data: Float32Array } }>;
  RawImage: RawImageType;
  coldLoadMs: number;
};

let clipLoadPromise: Promise<LoadedClip> | null = null;
let clipReadyLogged = false;

function normalizeL2(data: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i] * data[i];
  const n = Math.sqrt(s) || 1;
  const o = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) o[i] = data[i] / n;
  return o;
}

function cosineUnitWithRaw(a: Float32Array, unitB: Float32Array): number {
  let dot = 0;
  let na = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * unitB[i];
    na += a[i] * a[i];
  }
  return dot / (Math.sqrt(na) || 1);
}

function cosineUnitPair(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function aspectRatioOutOfProductRange(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return true;
  const r = width / height;
  return r < ASPECT_MIN || r > ASPECT_MAX;
}

async function embedThreeTextPrompts(
  clip: LoadedClip,
  a: string,
  b: string,
  c: string
): Promise<{
  textUnit: Float32Array;
  textUnitFullProduct: Float32Array;
  textUnitCloseUp: Float32Array;
}> {
  const textInputs = clip.tokenizer([a, b, c], {
    padding: true,
    truncation: true,
  });
  const { text_embeds } = await clip.textModel(textInputs);
  const te = text_embeds.data as Float32Array;
  const d = te.length / 3;
  if (!Number.isInteger(d) || d <= 0) {
    throw new Error("[vision] text_embeds batch inattendu");
  }
  return {
    textUnit: normalizeL2(te.subarray(0, d)),
    textUnitFullProduct: normalizeL2(te.subarray(d, d * 2)),
    textUnitCloseUp: normalizeL2(te.subarray(d, d * 3)),
  };
}

async function loadClipOnce(): Promise<LoadedClip> {
  const t0 = performance.now();
  const xf = await import("@xenova/transformers");
  xf.env.allowLocalModels = false;

  const loadWithQuant = async (quantized: boolean) => {
    const [tokenizer, processor, textModel, visionModel] = await Promise.all([
      xf.AutoTokenizer.from_pretrained(CLIP_MODEL_ID),
      xf.AutoProcessor.from_pretrained(CLIP_MODEL_ID),
      xf.CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL_ID, { quantized }),
      xf.CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL_ID, { quantized }),
    ]);
    return { tokenizer, processor, textModel, visionModel };
  };

  let pack: Awaited<ReturnType<typeof loadWithQuant>>;
  try {
    pack = await loadWithQuant(true);
  } catch {
    pack = await loadWithQuant(false);
  }

  const { tokenizer, processor, textModel, visionModel } = pack;

  const coldLoadMs = Math.round(performance.now() - t0);

  return {
    processor: (image: unknown) => processor(image) as Promise<unknown>,
    visionModel,
    tokenizer: tokenizer as LoadedClip["tokenizer"],
    textModel,
    RawImage: xf.RawImage,
    coldLoadMs,
  };
}

async function getClip(): Promise<LoadedClip> {
  if (!clipLoadPromise) {
    clipLoadPromise = loadClipOnce();
  }
  const c = await clipLoadPromise;
  if (process.env.NODE_ENV === "development" && !clipReadyLogged) {
    clipReadyLogged = true;
    console.info(
      `[vision] CLIP prêt — ${CLIP_MODEL_ID} (chargement initial ${c.coldLoadMs} ms dans ce process)`
    );
  }
  return c;
}

async function readRemoteImage(
  url: string,
  RawImage: RawImageType
): Promise<Awaited<ReturnType<typeof RawImage.read>> | null> {
  try {
    return await RawImage.read(url);
  } catch {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; LeCoinMoto-Argus/1.0)",
          Accept: "image/*,*/*",
        },
      });
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      const blob = new Blob([buf]);
      return await RawImage.fromBlob(blob);
    } catch {
      return null;
    }
  }
}

export type FilterClipOptions = {
  maxOut?: number;
  minMotorcycleCosine?: number;
  dedupeCosineMin?: number;
  /** Marge : refus « close-up » si cos(B) > cos(A) + marge (défaut 0.15). */
  closeUpMargin?: number;
  /** Famille d’équipement : libellés CLIP dynamiques. */
  equipmentCategory: SerperEquipmentCategory;
};

/** Métriques renvoyées en développement (journal technique UI + logs serveur). */
export type ClipPipelineDebug = {
  modelId: string;
  textPrompt: string;
  equipmentCategory: SerperEquipmentCategory;
  closeUpMargin: number;
  closeUpRelaxedForQuantity: boolean;
  rescuedFromCloseUpFilter: number;
  /** Temps chargement tokenizer + vision + texte + embed phrase (1ère fois dans le process). */
  modelColdLoadMs: number;
  /** Temps total getClip + boucle filtre pour cette requête. */
  requestTotalMs: number;
  inputUrlCount: number;
  outputUrlCount: number;
  thresholds: {
    minMotorcycleCosine: number;
    dedupeCosineMin: number;
    closeUpMargin: number;
  };
  rejectedFetch: number;
  rejectedProcessor: number;
  rejectedVision: number;
  rejectedMotorcycleScore: number;
  rejectedGeometry: number;
  rejectedCloseUpShot: number;
  rejectedDuplicate: number;
};

export type ClipFilterOutcome = {
  urls: string[];
  /** Renseigné seulement en `NODE_ENV === "development"`. */
  debug?: ClipPipelineDebug;
};

type DeferredCloseUp = { url: string; imgUnit: Float32Array };

/**
 * Parcourt les URLs dans l’ordre, applique CLIP (famille + vue complète vs gros plan avec marge).
 * Si moins de 2 images retenues : réintègre les seuls refus « gros plan » (quantité > perfection).
 */
export async function filterSerperImagesWithClip(
  rankedImageUrls: string[],
  options: FilterClipOptions
): Promise<ClipFilterOutcome> {
  const maxOut = options.maxOut ?? 6;
  const minMc = options.minMotorcycleCosine ?? MIN_MOTORCYCLE_COSINE;
  const dedupeMin = options.dedupeCosineMin ?? DEDUPLICATE_COSINE_MIN;
  const closeUpMargin =
    options.closeUpMargin ?? CLOSE_UP_SCORE_MARGIN_DEFAULT;
  const category = options.equipmentCategory;

  const prompts = getClipPromptTriplet(category);
  const dev = process.env.NODE_ENV === "development";

  const tReq0 = performance.now();

  let rejectedFetch = 0;
  let rejectedProcessor = 0;
  let rejectedVision = 0;
  let rejectedMotorcycleScore = 0;
  let rejectedGeometry = 0;
  let rejectedCloseUpShot = 0;
  let rejectedDuplicate = 0;

  const {
    processor,
    visionModel,
    tokenizer,
    textModel,
    RawImage,
    coldLoadMs,
  } = await getClip();

  const loaded: LoadedClip = {
    processor,
    visionModel,
    tokenizer,
    textModel,
    RawImage,
    coldLoadMs,
  };

  const { textUnit, textUnitFullProduct, textUnitCloseUp } =
    await embedThreeTextPrompts(
      loaded,
      prompts.relevance,
      prompts.labelFullProduct,
      prompts.labelCloseUp
    );

  const kept: string[] = [];
  const keptUnitEmbeds: Float32Array[] = [];
  const closeUpDeferred: DeferredCloseUp[] = [];

  const tryPushKept = (url: string, imgUnit: Float32Array): boolean => {
    if (kept.length >= maxOut) return true;
    for (const prev of keptUnitEmbeds) {
      if (cosineUnitPair(prev, imgUnit) >= dedupeMin) {
        rejectedDuplicate += 1;
        return false;
      }
    }
    kept.push(url);
    keptUnitEmbeds.push(imgUnit);
    return true;
  };

  for (const url of rankedImageUrls) {
    if (kept.length >= maxOut) break;

    const image = await readRemoteImage(url, RawImage);
    if (!image) {
      rejectedFetch += 1;
      continue;
    }

    if (aspectRatioOutOfProductRange(image.width, image.height)) {
      rejectedGeometry += 1;
      continue;
    }

    let imageInputs: unknown;
    try {
      imageInputs = await processor(image);
    } catch {
      rejectedProcessor += 1;
      continue;
    }

    let imageEmb: Float32Array;
    try {
      const out = await visionModel(imageInputs);
      imageEmb = out.image_embeds.data as Float32Array;
    } catch {
      rejectedVision += 1;
      continue;
    }

    const cosText = cosineUnitWithRaw(imageEmb, textUnit);
    if (cosText < minMc) {
      rejectedMotorcycleScore += 1;
      continue;
    }

    const cosFull = cosineUnitWithRaw(imageEmb, textUnitFullProduct);
    const cosClose = cosineUnitWithRaw(imageEmb, textUnitCloseUp);
    const closeUpReject = cosClose > cosFull + closeUpMargin;

    const imgUnit = normalizeL2(imageEmb);

    if (!closeUpReject) {
      tryPushKept(url, imgUnit);
      continue;
    }

    rejectedCloseUpShot += 1;
    let dup = false;
    for (const prev of keptUnitEmbeds) {
      if (cosineUnitPair(prev, imgUnit) >= dedupeMin) {
        dup = true;
        break;
      }
    }
    if (!dup) {
      closeUpDeferred.push({ url, imgUnit });
    }
  }

  let rescuedFromCloseUpFilter = 0;
  let closeUpRelaxedForQuantity = false;

  if (kept.length < MIN_OUTPUT_BEFORE_CLOSEUP_RELAX && closeUpDeferred.length > 0) {
    closeUpRelaxedForQuantity = true;
    for (const { url, imgUnit } of closeUpDeferred) {
      if (kept.length >= maxOut) break;
      const before = kept.length;
      tryPushKept(url, imgUnit);
      if (kept.length > before) rescuedFromCloseUpFilter += 1;
    }
  }

  const requestTotalMs = Math.round(performance.now() - tReq0);

  const textPrompt = `${prompts.relevance} | ${prompts.labelFullProduct} vs ${prompts.labelCloseUp}`;

  if (dev) {
    console.info("[vision] filtre CLIP", {
      ms: requestTotalMs,
      category,
      in: rankedImageUrls.length,
      out: kept.length,
      closeUpRelaxedForQuantity,
      rescuedFromCloseUpFilter,
      reject: {
        fetch: rejectedFetch,
        processor: rejectedProcessor,
        vision: rejectedVision,
        motorcycleScore: rejectedMotorcycleScore,
        geometry: rejectedGeometry,
        closeUpShot: rejectedCloseUpShot,
        duplicate: rejectedDuplicate,
      },
    });
  }

  const debug: ClipPipelineDebug | undefined = dev
    ? {
        modelId: CLIP_MODEL_ID,
        textPrompt,
        equipmentCategory: category,
        closeUpMargin,
        closeUpRelaxedForQuantity,
        rescuedFromCloseUpFilter,
        modelColdLoadMs: coldLoadMs,
        requestTotalMs,
        inputUrlCount: rankedImageUrls.length,
        outputUrlCount: kept.length,
        thresholds: { minMotorcycleCosine: minMc, dedupeCosineMin: dedupeMin, closeUpMargin },
        rejectedFetch,
        rejectedProcessor,
        rejectedVision,
        rejectedMotorcycleScore,
        rejectedGeometry,
        rejectedCloseUpShot,
        rejectedDuplicate,
      }
    : undefined;

  return { urls: kept, ...(debug ? { debug } : {}) };
}
