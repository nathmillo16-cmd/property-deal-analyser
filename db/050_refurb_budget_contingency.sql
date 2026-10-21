-- Run this in the Supabase SQL editor, after db/049.
-- Refurb budget: keeps the contingency part of the budget as its own figure.
--
-- Additive only, safe to re-run. One nullable column, nothing changed.
--
-- budget_contingency is the contingency inside budget_amount:
--   accepted quote:  budget_amount = quote inc VAT + contingency %,
--                    budget_contingency = that contingency
--   your estimate:   budget_amount = the estimate's grand total,
--                    budget_contingency = its contingency (inc VAT)
-- The budget tracker's "contingency left" draws from it. Before this is
-- run (or for a budget set before it), the page works it out from the
-- estimate's contingency % instead.
alter table refurb_estimates add column if not exists budget_contingency numeric
  check (budget_contingency is null or budget_contingency >= 0);
