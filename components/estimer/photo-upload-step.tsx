"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { MagnifyingGlass, Tag, TShirt, X } from "@phosphor-icons/react";
import { JacketIcon } from "@/components/icons/category-icons";
import { cn } from "@/lib/utils";
import {
  uiBody,
  uiBodySm,
  uiBtnGhostBar,
  uiBtnPrimaryBar,
  uiHeadingSection,
  uiInput,
} from "@/lib/ui/site-ui";

export type PhotoSlotId = "face" | "back" | "label" | "wear";

type SlotPreview = { file: File; url: string };

const SLOTS: {
  id: PhotoSlotId;
  title: string;
  Icon: React.ReactNode;
}[] = [
  {
    id: "face",
    title: "Face sur cintre",
    Icon: (
      <JacketIcon
        className="size-9 text-slate-400 sm:size-10"
        aria-hidden
      />
    ),
  },
  {
    id: "back",
    title: "Dos",
    Icon: (
      <TShirt
        className="size-9 scale-x-[-1] text-slate-400 sm:size-10"
        weight="duotone"
        aria-hidden
      />
    ),
  },
  {
    id: "label",
    title: "Étiquette CE",
    Icon: (
      <Tag className="size-9 text-slate-400 sm:size-10" weight="duotone" aria-hidden />
    ),
  },
  {
    id: "wear",
    title: "Défauts",
    Icon: (
      <MagnifyingGlass
        className="size-9 text-slate-400 sm:size-10"
        weight="duotone"
        aria-hidden
      />
    ),
  },
];

const spring = { type: "spring" as const, stiffness: 320, damping: 32 };

export type PhotoUploadStepProps = {
  onBack: () => void;
  onSubmit: (payload: {
    photos: Partial<Record<PhotoSlotId, File>>;
    pilotStory: string;
  }) => Promise<void>;
  isSubmitting?: boolean;
};

export function PhotoUploadStep({
  onBack,
  onSubmit,
  isSubmitting = false,
}: PhotoUploadStepProps) {
  const [photos, setPhotos] = React.useState<Partial<Record<PhotoSlotId, SlotPreview>>>(
    {}
  );
  const [pilotStory, setPilotStory] = React.useState("");
  const [dragOverId, setDragOverId] = React.useState<PhotoSlotId | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const revokeUrl = React.useCallback((url: string | undefined) => {
    if (url) URL.revokeObjectURL(url);
  }, []);

  const photosRef = React.useRef(photos);
  photosRef.current = photos;
  React.useEffect(() => {
    return () => {
      for (const p of Object.values(photosRef.current)) {
        if (p?.url) URL.revokeObjectURL(p.url);
      }
    };
  }, []);

  const setSlotFile = React.useCallback(
    (id: PhotoSlotId, file: File | null) => {
      setPhotos((prev) => {
        const next = { ...prev };
        const existing = prev[id];
        if (existing) revokeUrl(existing.url);
        if (!file || !file.type.startsWith("image/")) {
          delete next[id];
          return next;
        }
        next[id] = { file, url: URL.createObjectURL(file) };
        return next;
      });
    },
    [revokeUrl]
  );

  const onInputChange = (id: PhotoSlotId, e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setSlotFile(id, f);
    e.target.value = "";
  };

  const onDrop = (id: PhotoSlotId, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image/")) setSlotFile(id, f);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const out: Partial<Record<PhotoSlotId, File>> = {};
    for (const id of Object.keys(photos) as PhotoSlotId[]) {
      const p = photos[id];
      if (p?.file) out[id] = p.file;
    }
    if (Object.keys(out).length < 1) {
      setError("Ajoutez au moins une photo pour que l’atelier puisse avancer.");
      return;
    }
    try {
      await onSubmit({
        photos: out,
        pilotStory: pilotStory.trim(),
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Envoi impossible. Réessayez."
      );
    }
  };

  return (
    <motion.div
      key="photo-upload"
      role="dialog"
      aria-modal="true"
      aria-labelledby="atelier-photo-title"
      initial={{ opacity: 0, x: 28 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={spring}
      className="fixed inset-0 z-[126] flex flex-col bg-[#FDFDFD]/97 backdrop-blur-md"
    >
      <form
        onSubmit={handleSubmit}
        className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col px-5 pb-6 pt-[max(1rem,env(safe-area-inset-top))] sm:max-w-3xl sm:px-8 sm:pb-8 sm:pt-8"
      >
        <div className="shrink-0 text-center">
          <h2 id="atelier-photo-title" className={cn(uiHeadingSection)}>
            L&apos;Atelier : Préparation de votre annonce
          </h2>
          <p className={cn("mx-auto mt-4 max-w-lg sm:mt-5", uiBody)}>
            Quatre vues nettes, comme sur une table d&apos;inspection : face,
            dos, conformité, défauts éventuels.
          </p>
        </div>

        <div className="mt-8 min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-4 sm:mt-10">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
            {SLOTS.map(({ id, title, Icon }) => {
              const preview = photos[id];
              const isOver = dragOverId === id;

              if (preview) {
                return (
                  <div
                    key={id}
                    className="relative aspect-[4/3] overflow-hidden rounded-2xl border-2 border-slate-200/90 bg-slate-100 shadow-sm"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={preview.url}
                      alt={`Aperçu : ${title}`}
                      className="size-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setSlotFile(id, null)}
                      className={cn(
                        "absolute right-2 top-2 flex size-9 items-center justify-center rounded-full",
                        "bg-slate-900/75 text-white shadow-md transition hover:bg-slate-900",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                      )}
                      aria-label={`Supprimer la photo ${title}`}
                    >
                      <X className="size-5" weight="bold" aria-hidden />
                    </button>
                    <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-3 pb-2.5 pt-8 text-center text-xs font-semibold text-white">
                      {title}
                    </p>
                  </div>
                );
              }

              return (
                <label
                  key={id}
                  htmlFor={`photo-slot-${id}`}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOverId(id);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDragOverId((cur) => (cur === id ? null : cur));
                    }
                  }}
                  onDrop={(e) => onDrop(id, e)}
                  className={cn(
                    "group flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-4 transition-colors sm:gap-4",
                    "bg-slate-50 border-slate-200",
                    "hover:border-emerald-600 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-500/25",
                    isOver && "border-emerald-600 bg-emerald-50/40"
                  )}
                >
                  <input
                    id={`photo-slot-${id}`}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => onInputChange(id, e)}
                  />
                  {Icon}
                  <span className="text-center text-sm font-semibold text-slate-700">
                    {title}
                  </span>
                  <span className={cn("text-center text-xs text-slate-500", uiBodySm)}>
                    Touchez pour capturer ou importer
                  </span>
                </label>
              );
            })}
          </div>

          <div className="mt-6">
            <label
              htmlFor="pilot-story"
              className="mb-2 block text-left text-sm font-medium text-slate-800"
            >
              Le mot du motard
              <span className="font-normal text-slate-500"> — facultatif</span>
            </label>
            <textarea
              id="pilot-story"
              value={pilotStory}
              onChange={(e) => setPilotStory(e.target.value)}
              rows={4}
              placeholder="Racontez l’histoire de cet équipement pour le prochain pilote…"
              className={cn(
                uiInput,
                "min-h-[7rem] w-full resize-y rounded-2xl px-4 py-3 text-base leading-relaxed"
              )}
            />
          </div>
        </div>

        {error ? (
          <p className="shrink-0 text-center text-xs font-medium text-amber-800">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex shrink-0 flex-col gap-3 sm:mt-6 sm:flex-row sm:justify-center sm:gap-4">
          <button
            type="button"
            onClick={onBack}
            disabled={isSubmitting}
            className={cn(uiBtnGhostBar, "w-full justify-center sm:w-auto")}
          >
            Retour
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className={cn(uiBtnPrimaryBar, "w-full sm:w-auto")}
          >
            {isSubmitting ? "Envoi en cours…" : "Générer mon annonce"}
          </button>
        </div>
      </form>
    </motion.div>
  );
}
