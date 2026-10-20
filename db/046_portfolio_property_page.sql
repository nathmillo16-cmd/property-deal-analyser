-- Run this in the Supabase SQL editor. Portfolio property page: mortgage,
-- tenancy and compliance details per property, a property photo, BRRR as a
-- property type, and a target LTV setting for "available to release".
--
-- Additive only: nothing is dropped except the old property_type check,
-- which is recreated with BRRR added. The app keeps working before this is
-- run (the new fields just can't be saved yet, and BRRR isn't offered).
--
-- RLS: portfolio_properties already scopes whole rows to auth.uid() =
-- user_id (005/006), so every new column is covered by those policies.
-- profiles already scopes to the user's own row. The new photo bucket gets
-- own-folder policies below.
--
-- Safe to re-run: IF NOT EXISTS everywhere, the data move only touches
-- rows not yet moved, policies are dropped and recreated.

-- ---------- property type: add BRRR ----------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'portfolio_properties'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%property_type%'
  loop
    execute format('alter table portfolio_properties drop constraint %I', c.conname);
  end loop;
end $$;

alter table portfolio_properties
  add constraint portfolio_properties_property_type_check
  check (property_type in ('BTL','HMO','SA','Flip','BRRR'));

-- ---------- mortgage ----------
-- monthly_mortgage (the payment) and mortgage_balance already exist.
alter table portfolio_properties add column if not exists lender text;
alter table portfolio_properties add column if not exists interest_rate numeric;
alter table portfolio_properties add column if not exists mortgage_type text;
alter table portfolio_properties add column if not exists fixed_rate_end_date date;
alter table portfolio_properties add column if not exists remaining_term_years numeric;

alter table portfolio_properties drop constraint if exists portfolio_properties_mortgage_type_check;
alter table portfolio_properties add constraint portfolio_properties_mortgage_type_check
  check (mortgage_type is null or mortgage_type in ('interest_only','repayment'));

-- ---------- tenancy ----------
alter table portfolio_properties add column if not exists tenant_names text;
alter table portfolio_properties add column if not exists tenancy_start date;
alter table portfolio_properties add column if not exists tenancy_end date;
alter table portfolio_properties add column if not exists rent_due_day integer;
alter table portfolio_properties add column if not exists deposit_amount numeric;

alter table portfolio_properties drop constraint if exists portfolio_properties_rent_due_day_check;
alter table portfolio_properties add constraint portfolio_properties_rent_due_day_check
  check (rent_due_day is null or (rent_due_day between 1 and 31));

-- ---------- compliance ----------
-- One jsonb object per property, validated by the server, e.g.
-- {"gas":{"date":"2026-03-01"},"epc":{"date":"2019-05-01","rating":"C"},
--  "deposit":{"protected":"yes","scheme":"DPS","date":"2025-01-10"},
--  "licence":{"not_required":true},"eicr":{"na":true}}
-- Statuses (OK / Due soon / Overdue / Missing) are worked out by the
-- server when it reads them, never stored.
alter table portfolio_properties add column if not exists compliance jsonb not null default '{}'::jsonb;

-- ---------- photo ----------
-- Path inside the private 'property-photos' bucket ("<user_id>/<property_id>/<uuid>.jpg").
alter table portfolio_properties add column if not exists photo_path text;

-- ---------- refinance date split ----------
-- "Refinance date" now only means a BRRR property still to be refinanced.
-- For every other property the old value was really the end of the fixed
-- rate, so it moves into fixed_rate_end_date and refinance_date is cleared.
-- (BRRR is new in this file, so every existing row moves.) Only rows that
-- haven't moved yet are touched, so re-running is harmless.
update portfolio_properties
set fixed_rate_end_date = refinance_date,
    refinance_date = null
where refinance_date is not null
  and property_type <> 'BRRR'
  and fixed_rate_end_date is null;

-- ---------- settings: target LTV ----------
-- Used for "available to release" (value x target LTV minus balance).
alter table profiles add column if not exists target_ltv numeric not null default 75;
alter table profiles drop constraint if exists profiles_target_ltv_check;
alter table profiles add constraint profiles_target_ltv_check check (target_ltv > 0 and target_ltv <= 100);

-- ---------- storage: private property photos bucket ----------
-- Compressed in the browser (about 1600px JPEG) before upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('property-photos', 'property-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "property photos insert own folder" on storage.objects;
create policy "property photos insert own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'property-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "property photos select own folder" on storage.objects;
create policy "property photos select own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'property-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "property photos delete own folder" on storage.objects;
create policy "property photos delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'property-photos' and (storage.foldername(name))[1] = auth.uid()::text);
