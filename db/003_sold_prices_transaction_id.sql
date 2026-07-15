-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query),
-- BEFORE running scripts/ingest-sold-prices.js.
--
-- sold_prices currently has no column that maps to HM Land Registry's own
-- "Transaction unique identifier" (the first field in every Price Paid Data
-- row), so there is nothing to safely re-run an upsert against — re-running
-- an insert-only ingest would duplicate every row. This adds that column
-- (nullable, so it doesn't disturb any existing rows that predate it) plus
-- a unique index on it, which scripts/ingest-sold-prices.js upserts against
-- (onConflict: 'transaction_id') to make re-runs idempotent.
--
-- `if not exists` on both statements makes this safe to re-run.

alter table sold_prices add column if not exists transaction_id text;

create unique index if not exists idx_sold_prices_transaction_id
  on sold_prices (transaction_id);
