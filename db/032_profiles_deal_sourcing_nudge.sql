-- Tracks the last time the logged-in dashboard showed the low-key "Deal
-- Sourcing" nudge banner to a given user, so it can be throttled to at
-- most once per 30 days (and shown again a month later if they still
-- haven't applied) rather than either nagging on every load or being
-- permanently dismissed. Nullable: no row has ever been shown one yet.
alter table profiles
  add column if not exists deal_sourcing_nudge_last_shown timestamptz;
