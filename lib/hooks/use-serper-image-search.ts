"use client";

import * as React from "react";
import type {
  PartnerImageSearchJson,
  SerperEquipmentCategory,
} from "@/lib/serper/partner-image-search";

const IMAGE_SEARCH_ROUTE = "/api/serper-images";

/** Évite un écran « vide » instantané pendant que le serveur (Serper + CLIP) travaille. */
const MIN_LOADING_VISIBLE_MS = 850;

const DIAG_JSON_MAX = 4000;

function formatJsonSnippet(data: unknown): string {
  try {
    const s = JSON.stringify(data, null, 2);
    if (s.length <= DIAG_JSON_MAX) return s;
    return `${s.slice(0, DIAG_JSON_MAX)}\n…`;
  } catch {
    return String(data);
  }
}

/** Raison d’échec côté `/api/serper-images` (évite d’afficher « connexion » pour une simple 404). */
export type ImageSearchFault =
  | { kind: "none" }
  | { kind: "network" }
  | { kind: "no_match"; message: string }
  | { kind: "config"; message: string }
  | { kind: "bad_request"; message: string }
  | { kind: "server"; code: number; message: string };

export type UseSerperImageSearchResult = {
  /** Jusqu’à 6 URLs après filtrage CLIP (sans doublons visuels). */
  imageUrls: string[];
  /** Première image (rétrocompat / focus principal). */
  imageUrl: string | null;
  /** Moyenne EUR des prix détectés sur les listings (proxy Serper). */
  estimatedMarketPriceEur: number | null;
  /** Titres alignés sur `imageUrls` (obsolescence, récap). */
  imageGalleryMeta: { url: string; title: string }[];
  isLoading: boolean;
  /**
   * @deprecated Préférez `fault` : vrai pour tout échec sauf `no_match` (404 métier).
   */
  apiError: boolean;
  fault: ImageSearchFault;
  /** Réponse ok mais liste d’images vide (anomalie ou filtre total). */
  emptyGallery: boolean;
  imageBroken: boolean;
  setImageBroken: React.Dispatch<React.SetStateAction<boolean>>;
  /** Journal technique (affiché seulement en dev dans l’UI). */
  debugLines: string[];
};

/**
 * Illustration indicative via Serper + filtre vision local (CLIP côté serveur).
 */
export function useSerperImageSearch(
  query: string,
  category: SerperEquipmentCategory
): UseSerperImageSearchResult {
  const [imageUrls, setImageUrls] = React.useState<string[]>([]);
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const [estimatedMarketPriceEur, setEstimatedMarketPriceEur] =
    React.useState<number | null>(null);
  const [imageGalleryMeta, setImageGalleryMeta] = React.useState<
    { url: string; title: string }[]
  >([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [apiError, setApiError] = React.useState(false);
  const [fault, setFault] = React.useState<ImageSearchFault>({ kind: "none" });
  const [emptyGallery, setEmptyGallery] = React.useState(false);
  const [debugLines, setDebugLines] = React.useState<string[]>([]);
  const [imageBroken, setImageBroken] = React.useState(false);

  const appendDebug = React.useCallback((line: string) => {
    setDebugLines((prev) => [...prev, line]);
  }, []);

  React.useEffect(() => {
    let alive = true;
    let minLoadTimer: number | null = null;
    const controller = new AbortController();
    const loadStartedAt = Date.now();

    const endLoadingSoon = () => {
      const elapsed = Date.now() - loadStartedAt;
      const rest = Math.max(0, MIN_LOADING_VISIBLE_MS - elapsed);
      minLoadTimer = window.setTimeout(() => {
        minLoadTimer = null;
        if (alive) setIsLoading(false);
      }, rest);
    };

    setImageUrls([]);
    setImageUrl(null);
    setEstimatedMarketPriceEur(null);
    setImageGalleryMeta([]);
    setApiError(false);
    setFault({ kind: "none" });
    setEmptyGallery(false);
    setImageBroken(false);
    setIsLoading(true);

    const lines: string[] = [
      "Proxy : " + IMAGE_SEARCH_ROUTE,
      "Serper + CLIP vision (serveur)",
    ];

    if (!query.trim()) {
      lines.push("Erreur : requête vide (marque + modèle).");
      setDebugLines(lines);
      const f: ImageSearchFault = {
        kind: "bad_request",
        message: "Requête vide (marque + modèle).",
      };
      setFault(f);
      setApiError(true);
      endLoadingSoon();
      return () => {
        alive = false;
        if (minLoadTimer != null) window.clearTimeout(minLoadTimer);
        controller.abort();
      };
    }

    /** URL relative = même origine que la page (évite écarts localhost vs 127.0.0.1). */
    const href = `${IMAGE_SEARCH_ROUTE}?${new URLSearchParams({
      q: query.trim(),
      category,
    }).toString()}`;
    lines.push(`GET ${window.location.origin}${href}`);
    setDebugLines(lines);

    fetch(href, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (!alive) return;
        let data: PartnerImageSearchJson;
        try {
          data = (await res.json()) as PartnerImageSearchJson;
        } catch (e) {
          appendDebug(`JSON invalide : ${e instanceof Error ? e.message : String(e)}`);
          setFault({ kind: "network" });
          setApiError(true);
          return;
        }

        appendDebug(`HTTP ${res.status}`);
        appendDebug(formatJsonSnippet(data));

        if (!data || typeof data !== "object" || !("ok" in data)) {
          appendDebug("Réponse proxy invalide (champ ok manquant).");
          setFault({
            kind: "server",
            code: res.status,
            message: "Réponse du serveur d’images invalide.",
          });
          setApiError(true);
          return;
        }

        if (!data.ok) {
          const msg = data.error.message;
          const code = data.error.code;
          appendDebug(`Erreur : ${msg}`);
          if (code === 404) {
            setFault({ kind: "no_match", message: msg });
            return;
          }
          if (code === 503) {
            setFault({ kind: "config", message: msg });
            setApiError(true);
            return;
          }
          if (code === 400) {
            setFault({ kind: "bad_request", message: msg });
            setApiError(true);
            return;
          }
          setFault({ kind: "server", code, message: msg });
          setApiError(true);
          return;
        }

        const urls = Array.isArray(data.imageUrls) ? data.imageUrls : [];
        const first = urls[0] ?? data.imageUrl ?? null;
        const emRaw = data.estimatedMarketPriceEur;
        const em =
          typeof emRaw === "number" && Number.isFinite(emRaw) && emRaw > 0
            ? Math.round(emRaw)
            : null;
        setEstimatedMarketPriceEur(em);
        const meta = Array.isArray(data.imageGalleryMeta)
          ? data.imageGalleryMeta.filter(
              (m): m is { url: string; title: string } =>
                m != null &&
                typeof m === "object" &&
                typeof (m as { url?: unknown }).url === "string"
            )
          : [];
        setImageGalleryMeta(
          meta.map((m) => ({
            url: m.url,
            title:
              typeof (m as { title?: unknown }).title === "string"
                ? (m as { title: string }).title
                : "",
          }))
        );
        if (urls.length === 0 && !first) {
          appendDebug("Réponse ok mais aucune URL d’image.");
          setEmptyGallery(true);
          return;
        }
        setImageUrls(urls.length > 0 ? urls : first ? [first] : []);
        setImageUrl(first);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        /** Strict Mode ou navigation : annulation volontaire, pas une « panne ». */
        if (controller.signal.aborted) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        const raw = e instanceof Error ? e.message : String(e);
        appendDebug(`Réseau : ${raw}`);
        if (
          raw === "Failed to fetch" ||
          (e instanceof TypeError && raw.includes("fetch"))
        ) {
          appendDebug(
            "Indice : le serveur Next ne répond pas (arrêté ?), le process a planté (souvent mémoire au 1er chargement CLIP), ou mélange d’URL localhost / 127.0.0.1 avec un autre onglet. Réessayez ; en dev, vérifiez le terminal du serveur."
          );
        }
        setFault({ kind: "network" });
        setApiError(true);
      })
      .finally(() => {
        if (alive) endLoadingSoon();
      });

    return () => {
      alive = false;
      if (minLoadTimer != null) window.clearTimeout(minLoadTimer);
      controller.abort();
    };
  }, [query, category, appendDebug]);

  React.useEffect(() => {
    setImageBroken(false);
  }, [imageUrl, imageUrls]);

  return {
    imageUrls,
    imageUrl,
    estimatedMarketPriceEur,
    imageGalleryMeta,
    isLoading,
    apiError,
    fault,
    emptyGallery,
    imageBroken,
    setImageBroken,
    debugLines,
  };
}
