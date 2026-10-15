-- Run this in the Supabase SQL editor. Deal Workspace Phase 1: a history
-- of pipeline_stage changes, which previously didn't exist anywhere —
-- deals.updated_at (db/017/018) only ever holds the single latest "last
-- touched" time, not a log of what changed and when. Backs the "stage
-- changed" entries in the new Activity Timeline (saved-deals.html).
--
-- Modelled on crm_activity_log (db/023)'s own trigger-populated audit-log
-- pattern, scoped to this user's own deals rather than superuser-only.
-- Immutable: select-only RLS, no insert policy — the only thing that ever
-- writes here is the SECURITY DEFINER trigger below, which bypasses RLS
-- for its own insert (same reasoning as touch_parent_deal_updated_at in
-- db/018: the write is already known-legitimate by the time the trigger
-- fires, since it only fires as a result of an UPDATE that already passed
-- deals' own RLS).
--
-- user_id is taken from new.user_id (the deals row's own owner), not
-- auth.uid() — correct regardless of what triggered the update (a normal
-- user's own request, or any future service-role/admin path), rather than
-- depending on auth.uid() still resolving correctly inside a trigger.
--
-- Safe to re-run: table/index use IF NOT EXISTS, policy and trigger/
-- function are dropped and recreated.

create table if not exists deal_stage_log (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  from_stage text,
  to_stage text,
  changed_at timestamptz not null default now()
);

alter table deal_stage_log enable row level security;

drop policy if exists "select own deal stage log" on deal_stage_log;
create policy "select own deal stage log" on deal_stage_log
  for select to authenticated using (auth.uid() = user_id);

create index if not exists idx_deal_stage_log_deal_id on deal_stage_log (deal_id, changed_at desc);

create or replace function log_deal_stage_change()
returns trigger as $$
begin
  if old.pipeline_stage is distinct from new.pipeline_stage then
    insert into deal_stage_log (deal_id, user_id, from_stage, to_stage)
    values (new.id, new.user_id, old.pipeline_stage, new.pipeline_stage);
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_deals_log_stage_change on deals;
create trigger trg_deals_log_stage_change
  after update on deals
  for each row
  execute function log_deal_stage_change();
