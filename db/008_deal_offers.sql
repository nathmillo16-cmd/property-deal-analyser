-- Run this in the Supabase SQL editor. Backs the Offer history section of
-- the pipeline deal detail modal (pipeline.html) and the
-- /api/deals/:dealId/offers + /api/offers/:id endpoints in server.js.
--
-- Same pattern as deal_notes (007) and portfolio_properties: personal data,
-- user_id defaults to auth.uid(), deal_id references deals(id) on delete
-- cascade. Unlike deal_notes, this DOES get an update policy — the offer's
-- outcome is editable in place (Pending/Rejected/Accepted/Withdrawn), so
-- server.js's PUT /api/offers/:id needs it. Learned from
-- 006_portfolio_properties_update_policy.sql: the update policy is easy to
-- forget and edits then silently fail, so it's included here from the start.
--
-- Safe to re-run: table/column/index all use `if not exists`, and each
-- policy is dropped and recreated so re-running this script doesn't error
-- on policies that already exist.

create table if not exists deal_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  deal_id uuid not null references deals(id) on delete cascade,
  amount numeric not null,
  offer_date date not null,
  outcome text not null default 'Pending' check (outcome in ('Pending','Rejected','Accepted','Withdrawn')),
  created_at timestamptz not null default now()
);

alter table deal_offers enable row level security;

drop policy if exists "select own deal offers" on deal_offers;
create policy "select own deal offers" on deal_offers
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "insert own deal offers" on deal_offers;
create policy "insert own deal offers" on deal_offers
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "update own deal offers" on deal_offers;
create policy "update own deal offers" on deal_offers
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own deal offers" on deal_offers;
create policy "delete own deal offers" on deal_offers
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists idx_deal_offers_deal_id on deal_offers (deal_id);
