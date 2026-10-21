-- Run this in the Supabase SQL editor. Deal Workspace Phase 2: a per-user
-- contact book (agents, solicitors, brokers, surveyors, etc.) — entirely
-- separate from Cameron's own superuser-only `crm_contacts` (db/022),
-- which is role-based RLS for the business's own leads/clients/partners.
-- This table is a plain per-user table, same ownership shape as
-- deal_notes/deal_offers: auth.uid() = user_id, real hard delete allowed
-- (no soft-delete convention here — this is the user's own address book,
-- not an audited business record).
--
-- One row per contact; a contact is NOT deal-specific (deal_contact_roles,
-- db/054, is the join that assigns a contact to a role on a given deal —
-- the same contact can be assigned on many deals from this one row).
--
-- Renumbered from an earlier, never-committed db/041 — that number was
-- independently reused by Cameron's own 041_portfolio_equity_fields.sql
-- once his branch of work landed on main. The table itself was created
-- against the live database under that original numbering before the
-- clash was found; this file is safe to run regardless (CREATE TABLE IF
-- NOT EXISTS is a no-op if it already exists) and is now the correct
-- source-of-truth file for it going forward.
--
-- Safe to re-run: same idempotent pattern as every other migration here.

create table if not exists deal_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  company text,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table deal_contacts enable row level security;

drop policy if exists "select own deal contacts" on deal_contacts;
create policy "select own deal contacts" on deal_contacts
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "insert own deal contacts" on deal_contacts;
create policy "insert own deal contacts" on deal_contacts
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "update own deal contacts" on deal_contacts;
create policy "update own deal contacts" on deal_contacts
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own deal contacts" on deal_contacts;
create policy "delete own deal contacts" on deal_contacts
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists idx_deal_contacts_user_id on deal_contacts (user_id);

-- updated_at "last touched" tracking, same pattern as
-- touch_crm_contacts_updated_at() in db/022_crm_contacts.sql.
create or replace function touch_deal_contacts_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_deal_contacts_touch_updated_at on deal_contacts;
create trigger trg_deal_contacts_touch_updated_at
  before update on deal_contacts
  for each row
  execute function touch_deal_contacts_updated_at();
