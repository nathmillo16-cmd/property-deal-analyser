-- Run this in the Supabase SQL editor. Investor goals and a personal motto,
-- shown on Home (progress ring, property count, "months to go") and edited
-- in Settings > Goals.
--   goal_monthly_cashflow  -- target monthly cashflow (£)
--   goal_property_count    -- target number of properties
--   goal_target_date       -- optional date to hit the goal by
--   motto                  -- optional short personal motto, max 80 characters
--
-- All nullable, no defaults: "not set" is a normal state. Existing RLS on
-- profiles (own row, plus the superuser read policy) already covers these.
-- Written only by POST /api/profile/goals, which touches these four columns.
--
-- Safe to re-run: IF NOT EXISTS, and the check constraint is dropped first.

alter table profiles add column if not exists goal_monthly_cashflow numeric;
alter table profiles add column if not exists goal_property_count integer;
alter table profiles add column if not exists goal_target_date date;
alter table profiles add column if not exists motto text;

alter table profiles drop constraint if exists profiles_motto_length;
alter table profiles add constraint profiles_motto_length check (motto is null or char_length(motto) <= 80);
