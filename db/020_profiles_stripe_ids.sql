-- Run this in the Supabase SQL editor. Adds Stripe customer/subscription
-- id tracking to profiles — needed for delete-account to actually cancel
-- a real Stripe subscription before removing an account (server.js's
-- webhook now writes these on checkout.session.completed; before this
-- migration, nothing anywhere ever captured them, so
-- stripe_subscription_id read as "not present" and cancellation was
-- always skipped, not because of a bug but because there was nothing to
-- cancel). Also the prerequisite for a future Stripe Customer Portal
-- "Manage subscription" link in Settings.
--
-- Nullable, no default: existing accounts simply have both as null until
-- their next real checkout. Safe to re-run (IF NOT EXISTS).

alter table profiles add column if not exists stripe_customer_id text;
alter table profiles add column if not exists stripe_subscription_id text;
