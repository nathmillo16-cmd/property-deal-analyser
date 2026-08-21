-- Run this in the Supabase SQL editor. Referral tracking for
-- contact_category = 'referral_partner' contacts specifically - direction
-- 'sent' (we referred someone to them) or 'received' (they referred
-- someone to us). Requires db/022_crm_contacts.sql to have been run first.
--
-- Deliberately NOT auto-logged to crm_activity_log, unlike deal reviews and
-- task completion - the CRM spec only calls out those two as writing an
-- activity-log row automatically, and there's no matching event_type for a
-- referral in crm_activity_log's check constraint (db/023). Flagged in the
-- implementation plan as a scope line, not an oversight - straightforward
-- to add later (a new 'referral_added' event_type + an AFTER INSERT
-- trigger here, same shape as db/025) if wanted.
--
-- No update/delete policy - referrals are a running log, not edited after
-- the fact.
--
-- Safe to re-run: same idempotent pattern as every other migration here.

create table if not exists crm_partner_referrals (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references crm_contacts(id) on delete cascade,
  direction text not null check (direction in ('sent', 'received')),
  referred_name text not null,
  outcome text,
  value_estimate numeric,
  created_at timestamptz not null default now()
);

alter table crm_partner_referrals enable row level security;

drop policy if exists "superuser select crm_partner_referrals" on crm_partner_referrals;
create policy "superuser select crm_partner_referrals" on crm_partner_referrals
  for select to authenticated using (
    exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'superuser')
  );

drop policy if exists "superuser insert crm_partner_referrals" on crm_partner_referrals;
create policy "superuser insert crm_partner_referrals" on crm_partner_referrals
  for insert to authenticated with check (
    exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'superuser')
  );

create index if not exists idx_crm_partner_referrals_contact_id on crm_partner_referrals (contact_id);
