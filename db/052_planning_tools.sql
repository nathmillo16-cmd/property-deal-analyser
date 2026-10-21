-- Run this in the Supabase SQL editor. Planning tools (Tools menu >
-- Planning): Buy box and Private finance. The Portfolio stress test and
-- Refinance planner need nothing new: they read the portfolio's existing
-- columns.
--
-- Additive only: new nullable columns, two new tables and one private
-- Storage bucket. Nothing is renamed, dropped or changed on existing rows.
--
-- Safe to re-run: IF NOT EXISTS everywhere, ON CONFLICT DO NOTHING for the
-- bucket, and every constraint and policy is dropped and recreated.
--
-- The app keeps working before this is run: the Buy box page says it needs
-- a quick database update, deals simply have no bedrooms/property type
-- yet, and the Private finance page says the same.

-- ---------- profiles.buy_box ----------
-- The user's buy box, e.g.
-- {"strategies":["btl","brrr"],"max_price":160000,"min_yield":7,
--  "min_cashflow":200,"min_coc":10,"max_left_in":20000,
--  "areas":["NG9","Beeston"],"property_types":["terraced"],
--  "bedrooms_min":2,"bedrooms_max":3}
-- Validated by the server. Covered by the existing profiles RLS (own row only).
alter table profiles add column if not exists buy_box jsonb;

-- ---------- deals: property type and bedrooms ----------
-- Entered on the deal page (or filled from "Paste listing details"), so
-- deals can be checked against the buy box. Same words as the listing
-- reader uses. Covered by the existing deals RLS (own rows only).
alter table deals add column if not exists property_type text;
alter table deals add column if not exists bedrooms integer;

alter table deals drop constraint if exists deals_property_type_check;
alter table deals add constraint deals_property_type_check
  check (property_type is null or property_type in ('detached','semi-detached','terraced','end-terrace','flat','bungalow','maisonette','other'));

alter table deals drop constraint if exists deals_bedrooms_check;
alter table deals add constraint deals_bedrooms_check
  check (bedrooms is null or (bedrooms between 0 and 50));

-- ---------- private_loans ----------
-- One row per loan from a private lender (family, friend, JV partner...).
-- Balances and interest are worked out when the page loads, never stored.
create table if not exists private_loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lender_name text not null,
  relationship text not null default 'other',
  amount numeric not null,
  start_date date not null,
  interest_rate numeric not null default 0,
  interest_type text not null default 'simple',
  payment_type text not null default 'rolled_up',
  repayment_date date,
  security text not null default 'unsecured',
  property_id uuid references portfolio_properties(id) on delete set null,
  deal_id uuid references deals(id) on delete set null,
  notes text,
  -- Path inside the private 'loan-agreements' bucket ("<user_id>/<loan_id>/<uuid>.pdf").
  agreement_path text,
  agreement_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private_loans drop constraint if exists private_loans_relationship_check;
alter table private_loans add constraint private_loans_relationship_check
  check (relationship in ('family','friend','jv_partner','other'));
alter table private_loans drop constraint if exists private_loans_amount_check;
alter table private_loans add constraint private_loans_amount_check check (amount > 0);
alter table private_loans drop constraint if exists private_loans_rate_check;
alter table private_loans add constraint private_loans_rate_check check (interest_rate >= 0 and interest_rate <= 100);
alter table private_loans drop constraint if exists private_loans_interest_type_check;
alter table private_loans add constraint private_loans_interest_type_check check (interest_type in ('simple','compound'));
alter table private_loans drop constraint if exists private_loans_payment_type_check;
alter table private_loans add constraint private_loans_payment_type_check check (payment_type in ('monthly','rolled_up'));
alter table private_loans drop constraint if exists private_loans_security_check;
alter table private_loans add constraint private_loans_security_check check (security in ('unsecured','charge'));

create index if not exists private_loans_user_idx on private_loans (user_id);

alter table private_loans enable row level security;

-- Own rows only. A linked property or deal must also be the user's own.
drop policy if exists "select own private loans" on private_loans;
create policy "select own private loans" on private_loans
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "insert own private loans" on private_loans;
create policy "insert own private loans" on private_loans
  for insert to authenticated with check (
    auth.uid() = user_id
    and (property_id is null or exists (select 1 from portfolio_properties p where p.id = property_id and p.user_id = auth.uid()))
    and (deal_id is null or exists (select 1 from deals d where d.id = deal_id and d.user_id = auth.uid()))
  );

drop policy if exists "update own private loans" on private_loans;
create policy "update own private loans" on private_loans
  for update to authenticated using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and (property_id is null or exists (select 1 from portfolio_properties p where p.id = property_id and p.user_id = auth.uid()))
    and (deal_id is null or exists (select 1 from deals d where d.id = deal_id and d.user_id = auth.uid()))
  );

drop policy if exists "delete own private loans" on private_loans;
create policy "delete own private loans" on private_loans
  for delete to authenticated using (auth.uid() = user_id);

-- ---------- private_loan_repayments ----------
-- The repayments log for each loan. Deleted with the loan.
create table if not exists private_loan_repayments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  loan_id uuid not null references private_loans(id) on delete cascade,
  paid_on date not null,
  amount numeric not null,
  note text,
  created_at timestamptz not null default now()
);

alter table private_loan_repayments drop constraint if exists private_loan_repayments_amount_check;
alter table private_loan_repayments add constraint private_loan_repayments_amount_check check (amount > 0);

create index if not exists private_loan_repayments_loan_idx on private_loan_repayments (loan_id);

alter table private_loan_repayments enable row level security;

drop policy if exists "select own loan repayments" on private_loan_repayments;
create policy "select own loan repayments" on private_loan_repayments
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "insert own loan repayments" on private_loan_repayments;
create policy "insert own loan repayments" on private_loan_repayments
  for insert to authenticated with check (
    auth.uid() = user_id
    and exists (select 1 from private_loans l where l.id = loan_id and l.user_id = auth.uid())
  );

drop policy if exists "delete own loan repayments" on private_loan_repayments;
create policy "delete own loan repayments" on private_loan_repayments
  for delete to authenticated using (auth.uid() = user_id);

-- ---------- storage: private loan agreements bucket ----------
-- PDF, JPEG or PNG up to 10MB, one per loan, in the user's own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('loan-agreements', 'loan-agreements', false, 10485760, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;

drop policy if exists "loan agreements insert own folder" on storage.objects;
create policy "loan agreements insert own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'loan-agreements' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "loan agreements select own folder" on storage.objects;
create policy "loan agreements select own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'loan-agreements' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "loan agreements delete own folder" on storage.objects;
create policy "loan agreements delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'loan-agreements' and (storage.foldername(name))[1] = auth.uid()::text);
