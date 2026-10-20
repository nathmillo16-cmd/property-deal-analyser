-- Run this in the Supabase SQL editor. Property records: a photo gallery,
-- documents, a rent log and an expenses log per portfolio property, plus
-- the postcode / listing link / source deal carried over by "Move to
-- portfolio".
--
-- Needs db/046 first (it creates the property-photos bucket and the
-- photo_path column this file moves into the gallery).
--
-- Additive only. Nothing is dropped. The one data change: each property's
-- single photo (portfolio_properties.photo_path, db/046) is copied into the
-- new property_photos gallery as its first photo, then photo_path is
-- cleared so the same file isn't counted twice. The file itself stays
-- where it is in Storage.
--
-- The app keeps working before this is run: the new sections say they need
-- a quick database update, and photos keep using the single-photo slot.
--
-- RLS: every new table is scoped to auth.uid() = user_id, and inserts also
-- check the property belongs to the same user. The new 'property-docs'
-- bucket is private with own-folder policies ("<user_id>/...").
--
-- Safe to re-run: IF NOT EXISTS everywhere, policies are dropped and
-- recreated, the photo move only touches rows not yet moved.

-- ---------- portfolio_properties: carried over from a deal ----------
alter table portfolio_properties add column if not exists postcode text;
alter table portfolio_properties add column if not exists listing_url text;
alter table portfolio_properties add column if not exists source_deal_id uuid references deals(id) on delete set null;

-- Small helper used by the insert policies below: does this property
-- belong to the caller? security definer so it can read the row without
-- tripping RLS recursion; it only ever answers for auth.uid().
create or replace function owns_portfolio_property(pid uuid)
returns boolean as $$
  select exists (select 1 from portfolio_properties where id = pid and user_id = auth.uid());
$$ language sql stable security definer set search_path = public, pg_temp;

-- ---------- photos (gallery) ----------
-- storage_path is inside the private 'property-photos' bucket:
-- "<user_id>/<property_id>/<uuid>.jpg". Lowest position is the card image.
create table if not exists property_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  property_id uuid not null references portfolio_properties(id) on delete cascade,
  storage_path text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
alter table property_photos enable row level security;

drop policy if exists "select own property photos" on property_photos;
create policy "select own property photos" on property_photos
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "insert own property photos" on property_photos;
create policy "insert own property photos" on property_photos
  for insert to authenticated with check (auth.uid() = user_id and owns_portfolio_property(property_id));
drop policy if exists "update own property photos" on property_photos;
create policy "update own property photos" on property_photos
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "delete own property photos" on property_photos;
create policy "delete own property photos" on property_photos
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists idx_property_photos_property on property_photos (property_id, position, created_at);

-- Move each existing single photo into the gallery (only once).
insert into property_photos (user_id, property_id, storage_path, position, created_at)
select p.user_id, p.id, p.photo_path, 0, now()
from portfolio_properties p
where p.photo_path is not null
  and not exists (select 1 from property_photos ph where ph.storage_path = p.photo_path);
update portfolio_properties p
set photo_path = null
where p.photo_path is not null
  and exists (select 1 from property_photos ph where ph.storage_path = p.photo_path);

-- ---------- documents ----------
-- storage_path is inside the private 'property-docs' bucket:
-- "<user_id>/<property_id>/<uuid>.<pdf|jpg|png>".
-- compliance_key links the document to a compliance item (db/046 keys).
create table if not exists property_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  property_id uuid not null references portfolio_properties(id) on delete cascade,
  doc_type text not null,
  file_name text not null,
  storage_path text not null,
  content_type text not null,
  size_bytes integer,
  compliance_key text,
  created_at timestamptz not null default now(),
  constraint property_documents_doc_type_check
    check (doc_type in ('tenancy','gas','eicr','epc','mortgage_offer','insurance','other')),
  constraint property_documents_content_type_check
    check (content_type in ('application/pdf','image/jpeg','image/png')),
  constraint property_documents_compliance_key_check
    check (compliance_key is null or compliance_key in ('gas','eicr','epc','deposit','licence','alarms','right_to_rent'))
);
alter table property_documents enable row level security;

drop policy if exists "select own property documents" on property_documents;
create policy "select own property documents" on property_documents
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "insert own property documents" on property_documents;
create policy "insert own property documents" on property_documents
  for insert to authenticated with check (auth.uid() = user_id and owns_portfolio_property(property_id));
drop policy if exists "update own property documents" on property_documents;
create policy "update own property documents" on property_documents
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "delete own property documents" on property_documents;
create policy "delete own property documents" on property_documents
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists idx_property_documents_property on property_documents (property_id, created_at);

-- ---------- rent log ----------
-- One row per property per month the user has marked. month is the first
-- of that month. expected_amount is the monthly rent at the time it was
-- marked, so changing the rent later doesn't rewrite history.
--   received  paid in full (amount_received = expected_amount)
--   part      part paid (amount_received entered)
--   late      not in yet, being chased (amount_received 0)
--   missed    not paid (amount_received 0)
create table if not exists property_rent_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  property_id uuid not null references portfolio_properties(id) on delete cascade,
  month date not null,
  expected_amount numeric not null check (expected_amount >= 0),
  status text not null check (status in ('received','part','late','missed')),
  amount_received numeric not null default 0 check (amount_received >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_rent_log_month_first check (extract(day from month) = 1),
  constraint property_rent_log_unique unique (property_id, month)
);
alter table property_rent_log enable row level security;

drop policy if exists "select own rent log" on property_rent_log;
create policy "select own rent log" on property_rent_log
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "insert own rent log" on property_rent_log;
create policy "insert own rent log" on property_rent_log
  for insert to authenticated with check (auth.uid() = user_id and owns_portfolio_property(property_id));
drop policy if exists "update own rent log" on property_rent_log;
create policy "update own rent log" on property_rent_log
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "delete own rent log" on property_rent_log;
create policy "delete own rent log" on property_rent_log
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists idx_property_rent_log_user_status on property_rent_log (user_id, status);

-- ---------- expenses log ----------
-- Categories match UK property income records. Mortgage interest is kept
-- separate as finance costs. receipt_path, when set, is inside the
-- private 'property-docs' bucket: "<user_id>/<property_id>/receipts/<uuid>.<ext>".
create table if not exists property_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  property_id uuid not null references portfolio_properties(id) on delete cascade,
  expense_date date not null,
  amount numeric not null check (amount > 0),
  category text not null check (category in (
    'repairs','insurance','letting_fees','legal_professional','utilities',
    'ground_rent','council_tax','mortgage_interest','other')),
  description text,
  receipt_path text,
  receipt_type text check (receipt_type is null or receipt_type in ('application/pdf','image/jpeg','image/png')),
  created_at timestamptz not null default now()
);
alter table property_expenses enable row level security;

drop policy if exists "select own property expenses" on property_expenses;
create policy "select own property expenses" on property_expenses
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "insert own property expenses" on property_expenses;
create policy "insert own property expenses" on property_expenses
  for insert to authenticated with check (auth.uid() = user_id and owns_portfolio_property(property_id));
drop policy if exists "update own property expenses" on property_expenses;
create policy "update own property expenses" on property_expenses
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "delete own property expenses" on property_expenses;
create policy "delete own property expenses" on property_expenses
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists idx_property_expenses_property_date on property_expenses (property_id, expense_date);
create index if not exists idx_property_expenses_user_date on property_expenses (user_id, expense_date);

-- ---------- storage: private property documents bucket ----------
-- PDF, JPEG or PNG, up to 10MB. Documents and expense receipts both live
-- here. Viewing one means a signed URL that expires after 1 hour, created
-- by server.js for the owner only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('property-docs', 'property-docs', false, 10485760, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;

drop policy if exists "property docs insert own folder" on storage.objects;
create policy "property docs insert own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'property-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "property docs select own folder" on storage.objects;
create policy "property docs select own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'property-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "property docs delete own folder" on storage.objects;
create policy "property docs delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'property-docs' and (storage.foldername(name))[1] = auth.uid()::text);
