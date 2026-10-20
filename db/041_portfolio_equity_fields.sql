-- Run this in the Supabase SQL editor. Portfolio upgrade: four optional
-- per-property fields so the portfolio can show equity and refinance dates.
--   cash_invested     -- total cash the owner has put into the property (£)
--   current_value     -- today's estimated value (£)
--   mortgage_balance  -- outstanding mortgage (£), blank or 0 if owned outright
--   refinance_date    -- when the refinance window opens (used by Home's
--                        "Needs attention" panel, flagged 60 days ahead)
--
-- All nullable with no default, so every existing property simply has them
-- empty until the user fills them in. Equity (current_value minus
-- mortgage_balance) is computed by the server, never stored.
--
-- Existing RLS policies on portfolio_properties (005/006) already cover
-- these columns: they scope whole rows to auth.uid() = user_id.
--
-- Safe to re-run: IF NOT EXISTS.

alter table portfolio_properties add column if not exists cash_invested numeric;
alter table portfolio_properties add column if not exists current_value numeric;
alter table portfolio_properties add column if not exists mortgage_balance numeric;
alter table portfolio_properties add column if not exists refinance_date date;
