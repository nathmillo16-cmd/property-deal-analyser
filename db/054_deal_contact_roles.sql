-- Run this in the Supabase SQL editor. Deal Workspace Phase 2: assigns a
-- contact (deal_contacts, db/053) to one of three fixed roles on a deal.
-- Requires db/053 to have been run first.
--
-- Vendor / Broker / Surveyor only. Agent, Your solicitor and Their
-- solicitor are deliberately NOT offered here — Cameron's own flat Agent
-- fields (name/agency/phone/email, on the deal itself) and free-text
-- `solicitor` field are the single place for those, not duplicated into
-- Contacts. See the CLAUDE.md backlog note on migrating those into
-- Contacts properly later (including the listing reader, which currently
-- writes straight into the flat Agent fields and would need to create-
-- or-link an Agent contact instead).
--
-- "One contact per role per deal" is enforced by the database itself via
-- the unique(deal_id, role) constraint below, not just app-level logic —
-- assigning a different contact to an already-filled role is a genuine
-- upsert (on conflict (deal_id, role) do update), not an insert that could
-- ever produce two rows for the same role. "A contact can be on many
-- deals" needs no constraint at all — there's deliberately no uniqueness
-- on contact_id alone.
--
-- Unassigning a role deletes the row entirely (server.js does this when
-- contact_id is set to null) rather than updating it to a null contact_id
-- — keeps the table sparse.
--
-- Renumbered from an earlier, never-committed db/042 — see db/053's own
-- note on why. The table was originally created (and some rows possibly
-- inserted) against the live database with a WIDER role list (agent,
-- vendor, your_solicitor, their_solicitor, broker, surveyor); this file
-- narrows it to the three above. The DELETE below removes any existing
-- rows using a now-disallowed role BEFORE the narrower constraint is
-- added, since Postgres would otherwise refuse to add a CHECK constraint
-- that existing data already violates.
--
-- Plain per-user ownership RLS, same as deal_contacts — not role-based
-- like the crm_* tables.
--
-- Safe to re-run: same idempotent pattern as every other migration here.

create table if not exists deal_contact_roles (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  contact_id uuid not null references deal_contacts(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('vendor', 'broker', 'surveyor')),
  created_at timestamptz not null default now(),
  unique (deal_id, role)
);

alter table deal_contact_roles enable row level security;

drop policy if exists "select own deal contact roles" on deal_contact_roles;
create policy "select own deal contact roles" on deal_contact_roles
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "insert own deal contact roles" on deal_contact_roles;
create policy "insert own deal contact roles" on deal_contact_roles
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "update own deal contact roles" on deal_contact_roles;
create policy "update own deal contact roles" on deal_contact_roles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own deal contact roles" on deal_contact_roles;
create policy "delete own deal contact roles" on deal_contact_roles
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists idx_deal_contact_roles_deal_id on deal_contact_roles (deal_id);
-- Backs "on a contact, list the deals they're assigned to" (GET
-- /api/contacts/:id/deals) — the reverse lookup direction.
create index if not exists idx_deal_contact_roles_contact_id on deal_contact_roles (contact_id);

-- Narrows an already-existing table's role list, if it was created under
-- the original (wider) db/042 before the renumbering above. A no-op if
-- the table was just freshly created by the CREATE TABLE above (which
-- already has the narrow constraint inline) or if it's already narrow.
delete from deal_contact_roles where role in ('agent', 'your_solicitor', 'their_solicitor');

alter table deal_contact_roles drop constraint if exists deal_contact_roles_role_check;
alter table deal_contact_roles add constraint deal_contact_roles_role_check
  check (role in ('vendor', 'broker', 'surveyor'));
