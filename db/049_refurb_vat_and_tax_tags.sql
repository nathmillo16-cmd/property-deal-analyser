-- Run this in the Supabase SQL editor, after db/048.
-- Refurb estimator: VAT on builder quotes, and a tax tag on each payment.
--
-- Additive only, safe to re-run. Nothing is dropped. The estimator keeps
-- working before this is run: quotes are then treated as the amount
-- entered (no VAT setting), payments save without a tax tag, and logging
-- a payment to Portfolio says it needs this update.
--
-- refurb_quotes:
--   amount     stays the raw figure the builder quoted
--   vat_mode   'plus' = amount is before VAT, add vat_rate on top
--              'inc'  = amount already includes VAT
--   vat_rate   0, 5 or 20
--   Quotes saved before this file are marked 'inc' (they were entered as a
--   total), new ones default to 'plus' at 20%.
--
-- refurb_payments:
--   tax_tag    'capital' (improvement), 'repair' (like for like), 'unsure'
--              Payments already logged to Portfolio before this file were
--              logged as capital costs, so they become 'capital'; the rest
--              'unsure'.
--   portfolio_expense_id  set when a repair is logged to the property's
--              expense log (property_expenses, db/047), so deleting the
--              payment can delete that expense too.

-- ---------- quotes: VAT ----------
alter table refurb_quotes add column if not exists vat_mode text;
alter table refurb_quotes add column if not exists vat_rate numeric;
update refurb_quotes set vat_mode = 'inc' where vat_mode is null;
update refurb_quotes set vat_rate = 20 where vat_rate is null;
alter table refurb_quotes alter column vat_mode set default 'plus';
alter table refurb_quotes alter column vat_mode set not null;
alter table refurb_quotes alter column vat_rate set default 20;
alter table refurb_quotes alter column vat_rate set not null;
alter table refurb_quotes drop constraint if exists refurb_quotes_vat_mode_check;
alter table refurb_quotes add constraint refurb_quotes_vat_mode_check check (vat_mode in ('plus','inc'));
alter table refurb_quotes drop constraint if exists refurb_quotes_vat_rate_check;
alter table refurb_quotes add constraint refurb_quotes_vat_rate_check check (vat_rate in (0,5,20));

-- ---------- payments: tax tag + link to a property expense ----------
alter table refurb_payments add column if not exists tax_tag text;
update refurb_payments set tax_tag = 'capital' where tax_tag is null and portfolio_property_id is not null;
update refurb_payments set tax_tag = 'unsure' where tax_tag is null;
alter table refurb_payments alter column tax_tag set default 'unsure';
alter table refurb_payments alter column tax_tag set not null;
alter table refurb_payments drop constraint if exists refurb_payments_tax_tag_check;
alter table refurb_payments add constraint refurb_payments_tax_tag_check check (tax_tag in ('capital','repair','unsure'));

alter table refurb_payments add column if not exists portfolio_expense_id uuid references property_expenses(id) on delete set null;

-- The insert/update policies now also check a linked expense is the
-- caller's own (property_expenses is RLS-scoped, so the subquery only
-- ever sees the caller's rows).
drop policy if exists "insert own refurb payments" on refurb_payments;
create policy "insert own refurb payments" on refurb_payments
  for insert to authenticated with check (
    auth.uid() = user_id and owns_refurb_estimate(estimate_id)
    and (portfolio_property_id is null or owns_portfolio_property(portfolio_property_id))
    and (portfolio_expense_id is null or exists (select 1 from property_expenses e where e.id = portfolio_expense_id and e.user_id = auth.uid())));
drop policy if exists "update own refurb payments" on refurb_payments;
create policy "update own refurb payments" on refurb_payments
  for update to authenticated using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and (portfolio_property_id is null or owns_portfolio_property(portfolio_property_id))
    and (portfolio_expense_id is null or exists (select 1 from property_expenses e where e.id = portfolio_expense_id and e.user_id = auth.uid())));
