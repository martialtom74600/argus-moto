import type { SupabaseClient } from "@supabase/supabase-js";

export const MANDATE_PHOTOS_BUCKET = "mandate-photos";

/**
 * Garantit que le bucket public des photos mandat existe (création via service_role
 * si la migration SQL n’a pas encore été appliquée sur le projet).
 */
export async function ensureMandatePhotosBucket(
  supabase: SupabaseClient
): Promise<string | null> {
  const { data, error: getErr } = await supabase.storage.getBucket(
    MANDATE_PHOTOS_BUCKET
  );
  if (data && !getErr) return null;

  const { error: createErr } = await supabase.storage.createBucket(
    MANDATE_PHOTOS_BUCKET,
    {
      public: true,
      allowedMimeTypes: [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "image/heic",
      ],
      fileSizeLimit: 6 * 1024 * 1024,
    }
  );

  if (!createErr) return null;

  const msg = createErr.message ?? "";
  if (/already exists|duplicate|409/i.test(msg)) return null;

  return msg;
}
