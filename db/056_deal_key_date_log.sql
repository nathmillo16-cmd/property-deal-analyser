-- Run this in the Supabase SQL editor. Deal Workspace Phase 2: logs
-- "milestone reached" events into the Activity Timeline whenever a key
-- date's actual_date is set (or changed) to a non-null value. Requires
-- db/055_deal_key_dates.sql to have been run first.
--
-- Modelled directly on deal_stage_log/deal_refurb_log (db/038/039) —
-- immutable, trigger-populated, select-only RLS, no insert policy (the
-- SECURITY DEFINER trigger bypasses RLS for its own insert, same
-- reasoning as those two tables: the write is already known-legitimate by
-- the time the trigger fires, since it only runs as a result of an
-- UPDATE/INSERT that already passed deal_key_dates' own RLS).
--
-- Fires on every set/change of actual_date, not just the very first time
-- — correcting an actual date logs again as its own entry. A deliberate
-- choice, not an oversight: each value really was the recorded state at
-- that point, so each is a genuine timeline event.
--
-- This table's own milestone column has no CHECK constraint (it just
-- copies whatever deal_key_dates.milestone was at the time), so it is
-- NOT narrowed by the Viewing removal in db/055 — any 'viewing' rows
-- logged before that removal stay exactly as they are, immutable
-- history. saved-deals.html's own KEY_DATE_LABELS keeps a 'viewing'
-- entry purely so those old entries still render with a readable label.
--
-- user_id is taken from new.user_id (the deal_key_dates row's own owner),
-- same "don't depend on auth.uid() inside a trigger" reasoning as
-- deal_stage_log/deal_refurb_log.
--
-- Renumbered from an earlier, never-committed db/044 — see db/053's own
-- note on why. Unaffected by the Viewing/role narrowing in db/054/055.
--
-- Safe to re-run: table/index use IF NOT EXISTS, policy and trigger/
-- function are dropped and recreated.

create table if not exists deal_key_date_log (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  milestone text not null,
  actual_date date not null,
  created_at timestamptz not null default now()
);

alter table deal_key_date_log enable row level security;

drop policy if exists "select own deal key date log" on deal_key_date_log;
create policy "select own deal key date log" on deal_key_date_log
  for select to authenticated using (auth.uid() = user_id);

create index if not exists idx_deal_key_date_log_deal_id on deal_key_date_log (deal_id, created_at desc);

create or replace function log_deal_key_date_reached()
returns trigger as $$
begin
  if new.actual_date is not null
     and (tg_op = 'INSERT' or old.actual_date is distinct from new.actual_date)
  then
    insert into deal_key_date_log (deal_id, user_id, milestone, actual_date)
    values (new.deal_id, new.user_id, new.milestone, new.actual_date);
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_deal_key_dates_log_reached on deal_key_dates;
create trigger trg_deal_key_dates_log_reached
  after insert or update on deal_key_dates
  for each row
  execute function log_deal_key_date_reached();
