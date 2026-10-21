-- Run this in the Supabase SQL editor. Refurbishment Estimator upgrade:
-- estimate details (address, template, rooms, EPC ratings, duration),
-- the user's own rate card, builder quotes, the budget tracker and its
-- payments, plus a private 'refurb-quotes' Storage bucket.
--
-- Needs db/009 (refurb_estimates) and db/047 (owns_portfolio_property and
-- portfolio_properties.source_deal_id) first.
--
-- Additive only. Nothing is dropped and no existing row is changed. The
-- estimator keeps working before this is run: estimates still save
-- (without the new details), and Quotes, Budget and Your rates say they
-- need a quick database update.
--
-- RLS: every new table is scoped to auth.uid() = user_id, and inserts also
-- check the estimate (and portfolio property, when given) belongs to the
-- same user. The bucket is private with own-folder policies
-- ("<user_id>/<estimate_id>/...").
--
-- Safe to re-run: IF NOT EXISTS everywhere, policies dropped and recreated.

-- ---------- refurb_estimates: details + budget ----------
-- details holds { address, entry, template:{type,beds,scope},
-- rooms:{type,beds,choices:{<cardId>:{condition,note,photos:[path]}}},
-- epc:{current,target}, durationWeeks }. Opaque to the database, like
-- line_items.
alter table refurb_estimates add column if not exists details jsonb not null default '{}'::jsonb;
alter table refurb_estimates add column if not exists updated_at timestamptz not null default now();
-- Budget: set by "Accept quote" (the quote amount) or "Use my estimate as
-- budget" (the estimate's grand total at that moment). null = not started.
alter table refurb_estimates add column if not exists budget_amount numeric check (budget_amount is null or budget_amount >= 0);
alter table refurb_estimates add column if not exists budget_source text check (budget_source is null or budget_source in ('quote','estimate'));
alter table refurb_estimates add column if not exists pct_complete numeric not null default 0 check (pct_complete >= 0 and pct_complete <= 100);

-- Small helper for the insert policies below: does this estimate belong
-- to the caller? security definer so it can read the row without RLS
-- recursion; it only ever answers for auth.uid().
create or replace function owns_refurb_estimate(eid uuid)
returns boolean as $$
  select exists (select 1 from refurb_estimates where id = eid and user_id = auth.uid());
$$ language sql stable security definer set search_path = public, pg_temp;

-- ---------- rate card (one row per user) ----------
-- rates: { "<sectionId>.<itemId>": number }. Pre-fills "Your rate".
create table if not exists refurb_rate_cards (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  rates jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table refurb_rate_cards enable row level security;

drop policy if exists "select own rate card" on refurb_rate_cards;
create policy "select own rate card" on refurb_rate_cards
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "insert own rate card" on refurb_rate_cards;
create policy "insert own rate card" on refurb_rate_cards
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "update own rate card" on refurb_rate_cards;
create policy "update own rate card" on refurb_rate_cards
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "delete own rate card" on refurb_rate_cards;
create policy "delete own rate card" on refurb_rate_cards
  for delete to authenticated using (auth.uid() = user_id);

-- ---------- builder quotes ----------
-- file_path, when set, is in the private 'refurb-quotes' bucket:
-- "<user_id>/<estimate_id>/quotes/<uuid>.<pdf|jpg|png>".
create table if not exists refurb_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  estimate_id uuid not null references refurb_estimates(id) on delete cascade,
  builder_name text not null,
  contact text,
  amount numeric not null check (amount >= 0),
  quote_date date,
  timeline_weeks numeric check (timeline_weeks is null or timeline_weeks >= 0),
  notes text,
  file_path text,
  file_type text check (file_type is null or file_type in ('application/pdf','image/jpeg','image/png')),
  accepted boolean not null default false,
  created_at timestamptz not null default now()
);
alter table refurb_quotes enable row level security;

drop policy if exists "select own refurb quotes" on refurb_quotes;
create policy "select own refurb quotes" on refurb_quotes
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "insert own refurb quotes" on refurb_quotes;
create policy "insert own refurb quotes" on refurb_quotes
  for insert to authenticated with check (auth.uid() = user_id and owns_refurb_estimate(estimate_id));
drop policy if exists "update own refurb quotes" on refurb_quotes;
create policy "update own refurb quotes" on refurb_quotes
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "delete own refurb quotes" on refurb_quotes;
create policy "delete own refurb quotes" on refurb_quotes
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists idx_refurb_quotes_estimate on refurb_quotes (estimate_id, created_at);
-- At most one accepted quote per estimate.
create unique index if not exists idx_refurb_quotes_one_accepted on refurb_quotes (estimate_id) where accepted;

-- ---------- budget payments ----------
-- trade is a refurb category id (REFURB_SECTIONS in refurb-totals.js) or
-- 'other'. receipt_path, when set, is in 'refurb-quotes':
-- "<user_id>/<estimate_id>/receipts/<uuid>.<ext>".
-- portfolio_property_id is set when the user also logs the payment against
-- a property in their Portfolio, where it shows as a capital cost (never
-- as a day-to-day expense).
create table if not exists refurb_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  estimate_id uuid not null references refurb_estimates(id) on delete cascade,
  paid_date date not null,
  trade text not null,
  amount numeric not null check (amount > 0),
  description text,
  receipt_path text,
  receipt_type text check (receipt_type is null or receipt_type in ('application/pdf','image/jpeg','image/png')),
  portfolio_property_id uuid references portfolio_properties(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table refurb_payments enable row level security;

drop policy if exists "select own refurb payments" on refurb_payments;
create policy "select own refurb payments" on refurb_payments
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "insert own refurb payments" on refurb_payments;
create policy "insert own refurb payments" on refurb_payments
  for insert to authenticated with check (
    auth.uid() = user_id and owns_refurb_estimate(estimate_id)
    and (portfolio_property_id is null or owns_portfolio_property(portfolio_property_id)));
drop policy if exists "update own refurb payments" on refurb_payments;
create policy "update own refurb payments" on refurb_payments
  for update to authenticated using (auth.uid() = user_id) with check (
    auth.uid() = user_id and (portfolio_property_id is null or owns_portfolio_property(portfolio_property_id)));
drop policy if exists "delete own refurb payments" on refurb_payments;
create policy "delete own refurb payments" on refurb_payments
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists idx_refurb_payments_estimate on refurb_payments (estimate_id, paid_date);
create index if not exists idx_refurb_payments_property on refurb_payments (portfolio_property_id) where portfolio_property_id is not null;

-- ---------- storage: private refurb files bucket ----------
-- Quote documents, payment receipts and room or line photos for refurb
-- estimates. PDF, JPEG or PNG, up to 10MB. Viewing means a signed URL
-- (1 hour) created by server.js for the owner only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('refurb-quotes', 'refurb-quotes', false, 10485760, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;

drop policy if exists "refurb quotes insert own folder" on storage.objects;
create policy "refurb quotes insert own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'refurb-quotes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "refurb quotes select own folder" on storage.objects;
create policy "refurb quotes select own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'refurb-quotes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "refurb quotes delete own folder" on storage.objects;
create policy "refurb quotes delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'refurb-quotes' and (storage.foldername(name))[1] = auth.uid()::text);
