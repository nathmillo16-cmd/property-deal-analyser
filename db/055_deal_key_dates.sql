-- Run this in the Supabase SQL editor. Deal Workspace Phase 2: target and
-- actual dates for six fixed transaction milestones (Offer accepted,
-- Memorandum of sale, Survey, Mortgage offer, Exchange, Completion).
-- Sparse by design — a deal with nothing set yet has zero rows here; the
-- fixed six-item list is rendered client-side regardless (same approach
-- the pipeline's five fixed stages already use), with real rows only
-- appearing once a date is actually entered for that deal.
--
-- Viewing is deliberately NOT one of the milestones here — Cameron's own
-- deals.viewing_date (set from the Stage section) owns that one, not
-- duplicated. deals.viewing_date is untouched by this file.
--
-- unique(deal_id, milestone) backs the upsert pattern (POST
-- /api/deals/:dealId/key-dates does on conflict (deal_id, milestone) do
-- update) — at most one row per deal per milestone, both dates optional
-- and independent (an actual date can be set with no target ever having
-- existed, and vice versa).
--
-- Renumbered from an earlier, never-committed db/043 — see db/053's own
-- note on why. The table was originally created (and possibly some rows
-- inserted) against the live database with a WIDER milestone list that
-- also included 'viewing'; this file narrows it to the six above. The
-- DELETE below removes any existing 'viewing' rows BEFORE the narrower
-- constraint is added, since Postgres would otherwise refuse to add a
-- CHECK constraint that existing data already violates. Any
-- deal_key_date_log (db/056) rows already logged for a past 'viewing'
-- milestone are NOT touched — that log is immutable history, not
-- referentially linked to this table, and keeps its own 'viewing' label
-- for display purposes regardless of this narrowing.
--
-- Plain per-user ownership RLS, same as deal_contacts (db/053) — not
-- role-based like the crm_* tables.
--
-- Safe to re-run for the table/policy/index DDL (same idempotent pattern
-- as every other migration here).

create table if not exists deal_key_dates (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  milestone text not null check (milestone in ('offer_accepted', 'memorandum_of_sale', 'survey', 'mortgage_offer', 'exchange', 'completion')),
  target_date date,
  actual_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, milestone)
);

alter table deal_key_dates enable row level security;

drop policy if exists "select own deal key dates" on deal_key_dates;
create policy "select own deal key dates" on deal_key_dates
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "insert own deal key dates" on deal_key_dates;
create policy "insert own deal key dates" on deal_key_dates
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "update own deal key dates" on deal_key_dates;
create policy "update own deal key dates" on deal_key_dates
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists idx_deal_key_dates_deal_id on deal_key_dates (deal_id);

create or replace function touch_deal_key_dates_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_deal_key_dates_touch_updated_at on deal_key_dates;
create trigger trg_deal_key_dates_touch_updated_at
  before update on deal_key_dates
  for each row
  execute function touch_deal_key_dates_updated_at();

-- Narrows an already-existing table's milestone list, if it was created
-- under the original (wider, 'viewing'-included) db/043 before the
-- renumbering above. A no-op if the table was just freshly created by
-- the CREATE TABLE above (already narrow) or is already narrow.
delete from deal_key_dates where milestone = 'viewing';

alter table deal_key_dates drop constraint if exists deal_key_dates_milestone_check;
alter table deal_key_dates add constraint deal_key_dates_milestone_check
  check (milestone in ('offer_accepted', 'memorandum_of_sale', 'survey', 'mortgage_offer', 'exchange', 'completion'));
