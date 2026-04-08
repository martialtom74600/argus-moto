-- Leads conciergerie : capture post-estimation + URLs photos (bucket mandate-photos)

create table if not exists public.seller_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  first_name text not null,
  email text not null,
  phone text,
  pilot_story text,
  cote_argus_eur integer,
  offer_engine_eur integer,
  brand text not null,
  model text not null,
  category text not null,
  condition_label text not null,
  catalog_slug text,
  retail_reference_eur integer,
  completeness text,
  equipment_size text,
  helmet_age_band text,
  had_impact boolean,
  declinaison text,
  certified_argus boolean,
  photo_urls jsonb not null default '{}'::jsonb,
  estimate_snapshot jsonb
);

comment on table public.seller_leads is 'Demandes conciergerie / mandat (tunnel post-Argus).';

create index if not exists seller_leads_created_at_idx on public.seller_leads (created_at desc);
create index if not exists seller_leads_email_idx on public.seller_leads (email);

alter table public.seller_leads enable row level security;

-- Aucun accès public ; écriture via service_role (API Next) uniquement.

insert into storage.buckets (id, name, public)
values ('mandate-photos', 'mandate-photos', true)
on conflict (id) do update set public = excluded.public;

-- Lecture publique des clichés mandat (URLs retournées au client)
create policy "mandate_photos_select_public"
on storage.objects for select
to public
using (bucket_id = 'mandate-photos');
