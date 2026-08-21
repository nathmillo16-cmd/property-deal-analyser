-- Run this in the Supabase SQL editor. Adds seven new nullable "Investment
-- Defaults" columns to profiles, backing settings.html's new Investment
-- Defaults section (replacing the old "Preferences — coming soon" stub)
-- and pre-filling these same values on the calculator (index.html).
--
-- Scope note, resolved with the app's owner before this was written: the
-- original request for this feature listed several more fields than the
-- seven below. Four of them (target yield, target ROI, mortgage rate,
-- solicitor costs) already exist as profiles.target_yield / target_roi /
-- default_mortgage_rate / standard_fees.solicitor — those are reused as-is,
-- not duplicated here, so there is exactly one place each of those four
-- values lives. Four more (arrangement/broker fee, void %, minimum
-- monthly cashflow) were dropped entirely: none of them correspond to any
-- input that exists anywhere in the calculator today, and adding a column
-- + settings field that silently does nothing would be a false promise —
-- deferred to a later, separate piece of work alongside whatever
-- calculator inputs they'd actually need.
--
-- default_mortgage_type stores which of the calculator's three results
-- tabs (Cash/Interest-only/Repayment — see index.html's switchFinTab())
-- opens active by default. It is a display preference only: all three
-- modes are always computed regardless of this value, exactly as today —
-- this never changes what gets calculated, only which tab a user sees
-- first.
--
-- Every column defaults to null (nothing set) — a user with no saved
-- investment defaults sees exactly the calculator's existing hardcoded
-- values, unchanged. Safe to re-run: ADD COLUMN IF NOT EXISTS is
-- idempotent, same convention as every other migration here.

alter table profiles add column if not exists default_deposit_pct numeric;
alter table profiles add column if not exists default_mortgage_term_years integer;
alter table profiles add column if not exists default_mortgage_type text;
alter table profiles add column if not exists default_insurance numeric;
alter table profiles add column if not exists default_management_pct numeric;
alter table profiles add column if not exists default_maintenance_pct numeric;
alter table profiles add column if not exists default_refurb_contingency_pct numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_default_mortgage_type_check'
  ) then
    alter table profiles add constraint profiles_default_mortgage_type_check
      check (default_mortgage_type in ('cash', 'interest_only', 'repayment'));
  end if;
end $$;
