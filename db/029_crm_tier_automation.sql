-- Run this in the Supabase SQL editor. Tier automation: three new AFTER
-- triggers that auto-create crm_tasks rows in response to CRM events.
-- Additive only — crm_contacts, crm_tasks, crm_deal_reviews, and
-- crm_activity_log's own columns/policies are all untouched; this only
-- adds new trigger functions and attaches them alongside the existing
-- ones (crm_log_contact_changes on crm_contacts, crm_task_completion on
-- crm_tasks, crm_log_deal_review on crm_deal_reviews — none of those are
-- modified, Postgres fires multiple independent triggers on the same
-- event fine).
--
-- No SECURITY DEFINER on any of the three functions below, same reasoning
-- already documented on crm_log_contact_changes in db/023: each of these
-- only ever fires as a result of an insert/update that already passed its
-- own table's superuser-gated policy (is_superuser(), db/028), so the
-- caller is already a confirmed superuser — the insert into crm_tasks
-- below always satisfies crm_tasks' own INSERT policy on its own, running
-- as that same caller.
--
-- due_date is a plain `date` column (crm_tasks has no time-of-day
-- anywhere) — "due in 48 hours" / "due in 3 days" / "due in 2 days" are
-- all applied as whole calendar days from today (current_date + N), the
-- closest faithful mapping onto the column that exists rather than adding
-- a new timestamp column crm_tasks was never asked to grow.
--
-- Safe to re-run: same idempotent create-or-replace / drop-then-create
-- pattern as every other migration here.

-- (2) Tier 2/3 — auto-task on new application. Fires once, on insert only
-- (not on a later UPDATE that happens to set tier to tier2/3 — "new
-- application" means the row's tier was tier2/3 from the moment it was
-- created, not an existing contact retroactively promoted into one of
-- those tiers).
create or replace function crm_auto_task_new_application()
returns trigger as $$
begin
  if new.tier in ('tier2_acquisition_partner', 'tier3_private_sourcing') then
    insert into crm_tasks (contact_id, assigned_to, title, due_date)
    values (new.id, new.owner_id, 'Initial response', current_date + 2);
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_crm_auto_task_new_application on crm_contacts;
create trigger trg_crm_auto_task_new_application
  after insert on crm_contacts
  for each row
  execute function crm_auto_task_new_application();

-- (3) Tier 2 — auto-task when stage changes to qualified. `is distinct
-- from` (not `<>`) so a row that's already qualified being saved again
-- with no real stage change doesn't fire a second time — same guard style
-- crm_log_contact_changes already uses for its own stage_changed logging.
-- No assignee: unlike (2) above, the brief didn't specify one for this
-- task, so it's left unassigned (assigned_to null) rather than guessing
-- owner_id was intended here too.
create or replace function crm_auto_task_qualified()
returns trigger as $$
begin
  if new.tier = 'tier2_acquisition_partner'
     and new.stage = 'qualified'
     and old.stage is distinct from 'qualified'
  then
    insert into crm_tasks (contact_id, title, due_date)
    values (new.id, 'Book strategy session', current_date + 3);
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_crm_auto_task_qualified on crm_contacts;
create trigger trg_crm_auto_task_qualified
  after update on crm_contacts
  for each row
  execute function crm_auto_task_qualified();

-- (5) Tier 3 — every deal review gets a linked follow-up task. Implemented
-- as a trigger (same mechanism as (2)/(3) above) rather than purely a
-- client-side two-step form action, so the pairing is guaranteed
-- regardless of API path, not just enforced by one form in the UI. No
-- assignee specified in the brief here either, left null same as (3).
create or replace function crm_auto_task_deal_review()
returns trigger as $$
begin
  insert into crm_tasks (contact_id, title, due_date)
  values (new.contact_id, 'Follow up on ' || new.property_address || ' review', current_date + 2);
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_crm_auto_task_deal_review on crm_deal_reviews;
create trigger trg_crm_auto_task_deal_review
  after insert on crm_deal_reviews
  for each row
  execute function crm_auto_task_deal_review();
