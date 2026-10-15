-- Run this in the Supabase SQL editor. Deal Workspace Phase 1: a history
-- of refurb-estimate link/unlink events and "re-run and saved" events,
-- backing the refurb-related entries in the new Activity Timeline
-- (saved-deals.html). Nothing like this existed before — deals.
-- refurb_estimate_id (db/036) only ever holds the CURRENT link, not a log.
--
-- Two different write paths, both covered:
--  - 'linked' / 'unlinked': a trigger on deals, firing whenever
--    refurb_estimate_id actually changes. Using a trigger (not an explicit
--    insert from the PUT /api/deals/:id/refurb-estimate handler) matters
--    for one reason: db/036's "on delete set null" means deleting a
--    refurb_estimates row ALSO unlinks any deal pointing at it, via a
--    plain UPDATE under the hood with no server.js code path running at
--    all — only a trigger observes that. estimate_name is looked up at
--    the moment of the event (not the estimate's own current name, which
--    can change or disappear later) so the log entry stays meaningful even
--    after a rename or delete; if the unlink is itself CAUSED by deleting
--    that estimate, the lookup correctly returns nothing (the row's
--    already gone earlier in the same transaction) and the entry just
--    shows with no name — honest, not a bug.
--  - 'rerun_saved': inserted directly by server.js's
--    POST /api/deals/:id/refresh-figures on a successful save. That
--    endpoint deliberately never touches refurb_estimate_id, so the
--    trigger above can't see it; this is a genuinely separate write path
--    and needs its own explicit insert, done by the requester's own RLS-
--    scoped client, hence the one insert policy below.
--
-- user_id defaults to auth.uid() (useful for the server.js insert path)
-- but the trigger always sets it explicitly from new.user_id regardless,
-- for the same "don't depend on auth.uid() inside a trigger" reasoning as
-- deal_stage_log (db/038).
--
-- Safe to re-run: table/index use IF NOT EXISTS, policies and trigger/
-- function are dropped and recreated.

create table if not exists deal_refurb_log (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('linked', 'unlinked', 'rerun_saved')),
  estimate_name text,
  refurb_cost numeric,
  created_at timestamptz not null default now()
);

alter table deal_refurb_log enable row level security;

drop policy if exists "select own deal refurb log" on deal_refurb_log;
create policy "select own deal refurb log" on deal_refurb_log
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "insert own deal refurb log" on deal_refurb_log;
create policy "insert own deal refurb log" on deal_refurb_log
  for insert to authenticated with check (auth.uid() = user_id);

create index if not exists idx_deal_refurb_log_deal_id on deal_refurb_log (deal_id, created_at desc);

create or replace function log_deal_refurb_link_change()
returns trigger as $$
begin
  if old.refurb_estimate_id is distinct from new.refurb_estimate_id then
    insert into deal_refurb_log (deal_id, user_id, event_type, estimate_name)
    values (
      new.id, new.user_id,
      case when new.refurb_estimate_id is not null then 'linked' else 'unlinked' end,
      (select name from refurb_estimates
       where id = coalesce(new.refurb_estimate_id, old.refurb_estimate_id))
    );
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_deals_log_refurb_link on deals;
create trigger trg_deals_log_refurb_link
  after update on deals
  for each row
  execute function log_deal_refurb_link_change();
