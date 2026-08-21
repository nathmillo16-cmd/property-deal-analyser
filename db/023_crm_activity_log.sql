-- Run this in the Supabase SQL editor. The CRM's audit trail - every
-- action anywhere in the CRM writes a row here, either directly from the
-- app (notes, logged calls/emails - see the POST /api/admin/crm/contacts/
-- :id/activity route in server.js) or automatically via trigger whenever a
-- crm_contacts row changes (below). db/024 and db/025 add two more
-- triggers on top of this table, for task completion and deal reviews.
--
-- Requires db/022_crm_contacts.sql to have been run first.
--
-- Immutable log: RLS has select + insert only, no update/delete policy -
-- same convention as deal_notes (db/007), which also has no edit endpoint.
--
-- Safe to re-run: same idempotent pattern as every other migration here.

create table if not exists crm_activity_log (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references crm_contacts(id) on delete cascade,
  actor_id uuid references profiles(user_id) on delete set null,
  event_type text not null check (event_type in ('note', 'stage_changed', 'call_logged', 'email_sent', 'deal_reviewed', 'field_updated', 'task_completed')),
  event_detail jsonb,
  created_at timestamptz not null default now()
);

alter table crm_activity_log enable row level security;

drop policy if exists "superuser select crm_activity_log" on crm_activity_log;
create policy "superuser select crm_activity_log" on crm_activity_log
  for select to authenticated using (
    exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'superuser')
  );

drop policy if exists "superuser insert crm_activity_log" on crm_activity_log;
create policy "superuser insert crm_activity_log" on crm_activity_log
  for insert to authenticated with check (
    exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'superuser')
  );

create index if not exists idx_crm_activity_log_contact_id on crm_activity_log (contact_id, created_at desc);

-- Auto-logs crm_contacts changes. Fires AFTER the row is already updated
-- (and after touch_crm_contacts_updated_at's BEFORE trigger has already
-- bumped updated_at - excluded below since it changes on every edit and
-- isn't meaningful to log itself).
--
-- No SECURITY DEFINER needed: this trigger only ever fires as a result of
-- an UPDATE that already passed crm_contacts' own UPDATE policy, i.e. the
-- caller is already a confirmed superuser - so the insert below always
-- satisfies crm_activity_log's own INSERT policy on its own, running as
-- that same caller (unlike db/018's touch_parent_deal_updated_at, which
-- needs to write to a DIFFERENT table with no guaranteed matching policy).
create or replace function crm_log_contact_changes()
returns trigger as $$
begin
  if old.stage is distinct from new.stage then
    insert into crm_activity_log (contact_id, actor_id, event_type, event_detail)
    values (new.id, auth.uid(), 'stage_changed', jsonb_build_object('old_stage', old.stage, 'new_stage', new.stage));
  end if;

  if old.name is distinct from new.name
     or old.email is distinct from new.email
     or old.phone is distinct from new.phone
     or old.contact_category is distinct from new.contact_category
     or old.tier is distinct from new.tier
     or old.source is distinct from new.source
     or old.linked_user_id is distinct from new.linked_user_id
     or old.owner_id is distinct from new.owner_id
     or old.business_name is distinct from new.business_name
     or old.business_category is distinct from new.business_category
     or old.partner_tier is distinct from new.partner_tier
     or old.is_archived is distinct from new.is_archived
  then
    insert into crm_activity_log (contact_id, actor_id, event_type, event_detail)
    values (
      new.id, auth.uid(), 'field_updated',
      jsonb_build_object(
        'before', to_jsonb(old) - 'updated_at' - 'created_at',
        'after', to_jsonb(new) - 'updated_at' - 'created_at'
      )
    );
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_crm_log_contact_changes on crm_contacts;
create trigger trg_crm_log_contact_changes
  after update on crm_contacts
  for each row
  execute function crm_log_contact_changes();
