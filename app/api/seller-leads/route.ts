import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/db/supabase";
import {
  MANDATE_PHOTOS_BUCKET,
  ensureMandatePhotosBucket,
} from "@/lib/storage/mandate-photos-bucket";
import {
  sellerLeadBodySchema,
  type SellerLeadMetadata,
} from "@/lib/validation/sellerLead";

export const runtime = "nodejs";

const MAX_BYTES = 6 * 1024 * 1024;
const SLOTS = ["face", "back", "label", "wear"] as const;

function extFromMime(mime: string): string {
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/heic") return "heic";
  return "jpg";
}

export async function POST(req: Request) {
  let supabase: ReturnType<typeof getServiceSupabase>;
  try {
    supabase = getServiceSupabase();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Service indisponible (configuration)." },
      { status: 503 }
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { ok: false, message: "Content-Type multipart/form-data requis." },
      { status: 400 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, message: "Corps invalide." }, { status: 400 });
  }

  const rawMeta = form.get("metadata");
  if (typeof rawMeta !== "string") {
    return NextResponse.json({ ok: false, message: "metadata manquant." }, { status: 400 });
  }

  let parsedMeta: unknown;
  try {
    parsedMeta = JSON.parse(rawMeta);
  } catch {
    return NextResponse.json({ ok: false, message: "metadata JSON invalide." }, { status: 400 });
  }

  const validated = sellerLeadBodySchema.safeParse({
    firstName: form.get("first_name"),
    email: form.get("email"),
    phone: form.get("phone") || null,
    pilotStory: form.get("pilot_story") || null,
    metadata: parsedMeta,
  });

  if (!validated.success) {
    const msg = validated.error.issues.map((i) => i.message).join(" · ");
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }

  const {
    firstName,
    email,
    phone,
    pilotStory,
    metadata: meta,
  } = validated.data;

  const photoUrls: Record<string, string> = {};
  const leadId = crypto.randomUUID();

  const willUploadPhotos = SLOTS.some((slot) => {
    const file = form.get(`photo_${slot}`);
    return (
      file instanceof File &&
      file.size > 0 &&
      file.type.startsWith("image/")
    );
  });

  if (willUploadPhotos) {
    const bucketErr = await ensureMandatePhotosBucket(supabase);
    if (bucketErr) {
      return NextResponse.json(
        {
          ok: false,
          message: `Stockage photos indisponible : ${bucketErr}`,
        },
        { status: 503 }
      );
    }
  }

  for (const slot of SLOTS) {
    const field = `photo_${slot}`;
    const file = form.get(field);
    if (file == null || typeof file === "string") continue;
    if (!(file instanceof File) || file.size === 0) continue;
    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { ok: false, message: `Fichier ${slot} : type non supporté.` },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { ok: false, message: `Photo ${slot} trop volumineuse (max 6 Mo).` },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const ext = extFromMime(file.type);
    const path = `${leadId}/${slot}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from(MANDATE_PHOTOS_BUCKET)
      .upload(path, buf, {
        contentType: file.type || "image/jpeg",
        upsert: true,
      });

    if (upErr) {
      return NextResponse.json(
        {
          ok: false,
          message: `Échec envoi photo ${slot} : ${upErr.message}`,
        },
        { status: 500 }
      );
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(MANDATE_PHOTOS_BUCKET).getPublicUrl(path);
    photoUrls[slot] = publicUrl;
  }

  const row = mapMetadataToRow(meta, {
    id: leadId,
    first_name: firstName,
    email: email.trim().toLowerCase(),
    phone: phone?.trim() || null,
    pilot_story: pilotStory?.trim() || null,
    photo_urls: photoUrls,
  });

  const { error: insErr } = await supabase.from("seller_leads").insert(row);

  if (insErr) {
    return NextResponse.json(
      { ok: false, message: insErr.message || "Insertion échouée." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, id: leadId });
}

function mapMetadataToRow(
  meta: SellerLeadMetadata,
  extra: {
    id: string;
    first_name: string;
    email: string;
    phone: string | null;
    pilot_story: string | null;
    photo_urls: Record<string, string>;
  }
) {
  return {
    id: extra.id,
    first_name: extra.first_name,
    email: extra.email,
    phone: extra.phone,
    pilot_story: extra.pilot_story,
    cote_argus_eur: meta.coteArgusEur ?? null,
    offer_engine_eur: meta.offerEngineEur,
    brand: meta.brand,
    model: meta.model,
    category: meta.category,
    condition_label: meta.conditionLabel,
    catalog_slug: meta.catalogSlug ?? null,
    retail_reference_eur: meta.retailReferenceEur,
    completeness: meta.completeness ?? null,
    equipment_size: meta.equipmentSize?.trim() || null,
    helmet_age_band: meta.helmetAgeBand ?? null,
    had_impact: meta.hadImpact ?? null,
    declinaison: meta.declinaison?.trim() || null,
    certified_argus: meta.certifiedArgus ?? null,
    photo_urls: extra.photo_urls,
    estimate_snapshot: meta.snapshot ?? null,
  };
}
