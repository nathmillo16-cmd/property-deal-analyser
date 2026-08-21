-- Run this in the Supabase SQL editor. Core table of the superuser-only
-- internal CRM: one row per relationship that isn't just a plain software
-- signup (leads, Tier 2/3 clients, referral partners). Requires
-- db/021_profiles_role.sql to have been run first (RLS policies below
-- reference profiles.role).
--
-- Access is role-based, not ownership-based, unlike every other table in
-- this app (deals/portfolio_properties/etc, which use auth.uid() =
-- user_id): every crm_* table is readable/writable by ANY superuser, not
-- scoped to the row's own owner_id. owner_id is just "who's responsible",
-- not an access boundary.
--
-- Soft delete only: there is deliberately no DELETE policy on this table
-- (or on any other crm_* table) - "deleting" a contact through the app sets
-- is_archived = true via the same PUT used for any other edit, never a real
-- DELETE. Nothing in the CRM is ever hard-deleted through the app.
--
-- Safe to re-run: create table/policy use the same idempotent
-- if-not-exists / drop-and-recreate pattern as every other migration here
-- (see db/005_portfolio_properties.sql).

create table if not exists crm_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  contact_category text not null check (contact_category in ('lead', 'client', 'referral_partner')),
  tier text check (tier in ('tier1_software', 'tier2_acquisition_partner', 'tier3_private_sourcing')),
  stage text not null default 'new' check (stage in ('new', 'contacted', 'qualified', 'active', 'converted', 'lost', 'churned')),
  source text,
  linked_user_id uuid references profiles(user_id) on delete set null,
  owner_id uuid references profiles(user_id) on delete set null,
  business_name text,
  business_category text check (business_category in ('mortgage_broker', 'accountant', 'solicitor', 'surveyor', 'builder', 'letting_agent')),
  partner_tier int check (partner_tier in (1, 2, 3)),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table crm_contacts enable row level security;

drop policy if exists "superuser select crm_contacts" on crm_contacts;
create policy "superuser select crm_contacts" on crm_contacts
  for select to authenticated using (
    exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'superuser')
  );

drop policy if exists "superuser insert crm_contacts" on crm_contacts;
create policy "superuser insert crm_contacts" on crm_contacts
  for insert to authenticated with check (
    exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'superuser')
  );

drop policy if exists "superuser update crm_contacts" on crm_contacts;
create policy "superuser update crm_contacts" on crm_contacts
  for update to authenticated using (
    exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'superuser')
  ) with check (
    exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'superuser')
  );

create index if not exists idx_crm_contacts_owner_id on crm_contacts (owner_id);
create index if not exists idx_crm_contacts_linked_user_id on crm_contacts (linked_user_id);

-- updated_at "last touched" tracking, same pattern as
-- touch_deals_updated_at() in db/018_deals_touch_triggers.sql.
create or replace function touch_crm_contacts_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_crm_contacts_touch_updated_at on crm_contacts;
create trigger trg_crm_contacts_touch_updated_at
  before update on crm_contacts
  for each row
  execute function touch_crm_contacts_updated_at();
