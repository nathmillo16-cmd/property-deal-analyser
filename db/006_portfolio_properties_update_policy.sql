-- Run this in the Supabase SQL editor. Adds the missing `update` policy for
-- portfolio_properties — 005 defined select/insert/delete but not update,
-- which the new PUT /api/portfolio/:id endpoint needs. Same auth.uid() =
-- user_id scoping as the other three policies on this table.

drop policy if exists "update own portfolio properties" on portfolio_properties;
create policy "update own portfolio properties" on portfolio_properties
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
