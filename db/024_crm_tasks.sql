-- Run this in the Supabase SQL editor. Follow-ups/reminders against a CRM
-- contact. Requires db/023_crm_activity_log.sql to have been run first
-- (the completion trigger below writes into it).
--
-- No delete policy (same soft-delete stance as the rest of the CRM) - a
-- task created in error is just left incomplete or edited, not removed.
--
-- Safe to re-run: same idempotent pattern as every other migration here.

create table if not exists crm_tasks (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references crm_contacts(id) on delete cascade,
  assigned_to uuid references profiles(user_id) on delete set null,
  title text not null,
  due_date date,
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table crm_tasks enable row level security;

drop policy if exists "superuser select crm_tasks" on crm_tasks;
create policy "superuser select crm_tasks" on crm_tasks
  for select to authenticated using (
    exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'superuser')
  );

drop policy if exists "superuser insert crm_tasks" on crm_tasks;
create policy "superuser insert crm_tasks" on crm_tasks
  for insert to authenticated with check (
    exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'superuser')
  );

drop policy if exists "superuser update crm_tasks" on crm_tasks;
create policy "superuser update crm_tasks" on crm_tasks
  for update to authenticated using (
    exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'superuser')
  ) with check (
    exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'superuser')
  );

create index if not exists idx_crm_tasks_contact_id on crm_tasks (contact_id);
create index if not exists idx_crm_tasks_assigned_to on crm_tasks (assigned_to);

-- On completion (completed flips false -> true): stamps completed_at
-- server-side (never trusts a client-sent value) and logs a
-- task_completed row. Un-completing (true -> false) just clears
-- completed_at and logs nothing - not itself a loggable "event_type".
create or replace function crm_task_completion()
returns trigger as $$
begin
  if old.completed = false and new.completed = true then
    new.completed_at = now();
    insert into crm_activity_log (contact_id, actor_id, event_type, event_detail)
    values (new.contact_id, auth.uid(), 'task_completed', jsonb_build_object('task_id', new.id, 'title', new.title));
  elsif old.completed = true and new.completed = false then
    new.completed_at = null;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_crm_task_completion on crm_tasks;
create trigger trg_crm_task_completion
  before update on crm_tasks
  for each row
  execute function crm_task_completion();
