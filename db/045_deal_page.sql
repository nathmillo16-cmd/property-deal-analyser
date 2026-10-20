-- Run this in the Supabase SQL editor. Deals page + Deal page upgrade
-- (saved-deals.html / pipeline.html Deal Workspace). Everything here is
-- additive: new nullable columns on deals and deal_offers, two new tables,
-- and one private Storage bucket. Nothing existing is renamed or dropped.
--
-- The app keeps working before this is run: server.js falls back to the
-- old column list when these columns are missing, and the new sections
-- show a short "needs a database update" message instead of saving.
--
-- Safe to re-run: every column/table/index uses IF NOT EXISTS, the bucket
-- insert uses ON CONFLICT DO NOTHING, and every policy/trigger is dropped
-- and recreated.

-- ---------- deals: new per-deal fields ----------
-- address already exists (it was added earlier and never written to); the
-- Deal page now writes to it. postcode is its own column so comps/crime
-- can run straight from it.
alter table deals add column if not exists address text;
alter table deals add column if not exists postcode text;
alter table deals add column if not exists listing_url text;
-- { name, phone, email, agency }, all optional strings.
alter table deals add column if not exists agent jsonb;
-- { condition: { status: 'good'|'concern'|null, note }, damp: {...}, ... }
alter table deals add column if not exists viewing_checklist jsonb;
-- Asked for when a deal moves to Agreed.
alter table deals add column if not exists solicitor text;
alter table deals add column if not exists target_completion_date date;
-- Asked for when a deal moves to Lost.
alter table deals add column if not exists lost_reason text;
alter table deals add column if not exists lost_note text;
-- When the deal entered its current stage, for "X days in this stage".
alter table deals add column if not exists stage_changed_at timestamptz;

alter table deals drop constraint if exists deals_lost_reason_check;
alter table deals add constraint deals_lost_reason_check
  check (lost_reason is null or lost_reason in ('outbid','survey','numbers','vendor','other'));

-- Backfill stage_changed_at: the latest stage-log entry where one exists
-- (db/038), otherwise the last time the deal was touched, otherwise when
-- it was saved. Only fills rows that don't have a value yet.
update deals d
set stage_changed_at = coalesce(
  (select max(l.changed_at) from deal_stage_log l where l.deal_id = d.id),
  d.updated_at,
  d.created_at
)
where d.stage_changed_at is null;

alter table deals alter column stage_changed_at set default now();

-- Keeps stage_changed_at current on every stage change, whichever endpoint
-- made it. BEFORE UPDATE so it lands in the same write.
create or replace function set_deal_stage_changed_at()
returns trigger as $$
begin
  if old.pipeline_stage is distinct from new.pipeline_stage then
    new.stage_changed_at := now();
  end if;
  return new;
end;
$$ language plpgsql set search_path = public, pg_temp;

drop trigger if exists trg_deals_stage_changed_at on deals;
create trigger trg_deals_stage_changed_at
  before update on deals
  for each row
  execute function set_deal_stage_changed_at();

-- ---------- deal_offers: counter amount ----------
alter table deal_offers add column if not exists counter_amount numeric;

-- ---------- deal_reminders ----------
-- "Remind me" on the Deal page. Due ones (remind_on today or earlier, not
-- done) show in Home's "Your next move".
create table if not exists deal_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  deal_id uuid not null references deals(id) on delete cascade,
  remind_on date not null,
  note text not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

alter table deal_reminders enable row level security;

drop policy if exists "select own deal reminders" on deal_reminders;
create policy "select own deal reminders" on deal_reminders
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "insert own deal reminders" on deal_reminders;
create policy "insert own deal reminders" on deal_reminders
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "update own deal reminders" on deal_reminders;
create policy "update own deal reminders" on deal_reminders
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "delete own deal reminders" on deal_reminders;
create policy "delete own deal reminders" on deal_reminders
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists idx_deal_reminders_deal_id on deal_reminders (deal_id);
create index if not exists idx_deal_reminders_user_due on deal_reminders (user_id, done, remind_on);

-- ---------- deal_photos ----------
-- storage_path is the path inside the private 'deal-photos' bucket:
-- "<user_id>/<deal_id>/<uuid>.jpg". Viewing a photo means a short-lived
-- signed URL, created by server.js for the owner only.
create table if not exists deal_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  deal_id uuid not null references deals(id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);

alter table deal_photos enable row level security;

drop policy if exists "select own deal photos" on deal_photos;
create policy "select own deal photos" on deal_photos
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "insert own deal photos" on deal_photos;
create policy "insert own deal photos" on deal_photos
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "delete own deal photos" on deal_photos;
create policy "delete own deal photos" on deal_photos
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists idx_deal_photos_deal_id on deal_photos (deal_id, created_at);

-- ---------- storage: private deal photos bucket ----------
-- Photos are compressed in the browser before upload (about 1600px, JPEG),
-- so 5MB is a generous ceiling. JPEG only, since that is what the
-- compressor produces.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('deal-photos', 'deal-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

-- Each user can only upload into, read from, and delete from their own
-- folder ("<user_id>/...").
drop policy if exists "deal photos insert own folder" on storage.objects;
create policy "deal photos insert own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'deal-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "deal photos select own folder" on storage.objects;
create policy "deal photos select own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'deal-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "deal photos delete own folder" on storage.objects;
create policy "deal photos delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'deal-photos' and (storage.foldername(name))[1] = auth.uid()::text);
