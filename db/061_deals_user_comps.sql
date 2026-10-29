-- 061: your own comparables on a deal (my-comps.js). Holds which of our
-- comps the user removed and the ones they added themselves:
--   { excluded: [key], added: [{ id, address, price, status, date, beds, sqm, link, note }] }
-- Additive and nullable; the server reads and writes it with its own
-- failure-tolerant queries, so nothing breaks before this is run.
alter table public.deals add column if not exists user_comps jsonb;
