-- Run this in the Supabase SQL editor. Backs the Refurbishment Estimator
-- (refurb.html) and the /api/refurb-estimates endpoints in server.js.
--
-- Same pattern as deal_notes/deal_offers (007/008) and portfolio_properties
-- (005/006): personal data, user_id defaults to auth.uid(), RLS-scoped.
-- All four policies (select/insert/update/delete) are included from the
-- start, learned from 006_portfolio_properties_update_policy.sql where the
-- update policy was forgotten in the first pass and edits silently failed.
--
-- line_items is opaque jsonb whose shape depends on mode: for 'detailed' it's
-- { "<sectionId>.<itemId>": { "rate": number|null, "qty": number|null } },
-- for 'quick' it's { "<tradeId>": number }. The estimator does all its own
-- arithmetic client-side (line totals, subtotal, contingency, VAT, grand
-- total) — this table only ever stores what the user typed, not any
-- computed figure.
--
-- Safe to re-run: table/column/index all use `if not exists`, and each
-- policy is dropped and recreated so re-running this script doesn't error
-- on policies that already exist.

create table if not exists refurb_estimates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  mode text not null default 'detailed' check (mode in ('detailed','quick')),
  line_items jsonb not null default '{}'::jsonb,
  contingency_enabled boolean not null default true,
  contingency_pct numeric not null default 10,
  vat_rate numeric not null default 20 check (vat_rate in (0,5,20)),
  created_at timestamptz not null default now()
);

alter table refurb_estimates enable row level security;

drop policy if exists "select own refurb estimates" on refurb_estimates;
create policy "select own refurb estimates" on refurb_estimates
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "insert own refurb estimates" on refurb_estimates;
create policy "insert own refurb estimates" on refurb_estimates
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "update own refurb estimates" on refurb_estimates;
create policy "update own refurb estimates" on refurb_estimates
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own refurb estimates" on refurb_estimates;
create policy "delete own refurb estimates" on refurb_estimates
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists idx_refurb_estimates_user_id on refurb_estimates (user_id);
