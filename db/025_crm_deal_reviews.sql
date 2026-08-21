-- Run this in the Supabase SQL editor. Tier 2/3 specific deal reviews
-- against a CRM contact (matches the Acquisition Partner / Private
-- Sourcing offer docs). Requires db/023_crm_activity_log.sql to have been
-- run first (the trigger below writes into it).
--
-- No update/delete policy: a review is a point-in-time record of what was
-- decided at review_date - if the outcome later changes, add a new review
-- rather than editing history, same reasoning deal_offers used the
-- opposite way round for a genuinely-editable field (see db/008's comment).
--
-- Safe to re-run: same idempotent pattern as every other migration here.

create table if not exists crm_deal_reviews (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references crm_contacts(id) on delete cascade,
  property_address text not null,
  review_date date not null default current_date,
  outcome text not null check (outcome in ('pursue', 'negotiate', 'reject')),
  notes text,
  created_at timestamptz not null default now()
);

alter table crm_deal_reviews enable row level security;

drop policy if exists "superuser select crm_deal_reviews" on crm_deal_reviews;
create policy "superuser select crm_deal_reviews" on crm_deal_reviews
  for select to authenticated using (
    exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'superuser')
  );

drop policy if exists "superuser insert crm_deal_reviews" on crm_deal_reviews;
create policy "superuser insert crm_deal_reviews" on crm_deal_reviews
  for insert to authenticated with check (
    exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'superuser')
  );

create index if not exists idx_crm_deal_reviews_contact_id on crm_deal_reviews (contact_id);

create or replace function crm_log_deal_review()
returns trigger as $$
begin
  insert into crm_activity_log (contact_id, actor_id, event_type, event_detail)
  values (
    new.contact_id, auth.uid(), 'deal_reviewed',
    jsonb_build_object('property_address', new.property_address, 'outcome', new.outcome, 'review_date', new.review_date, 'notes', new.notes)
  );
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_crm_log_deal_review on crm_deal_reviews;
create trigger trg_crm_log_deal_review
  after insert on crm_deal_reviews
  for each row
  execute function crm_log_deal_review();
