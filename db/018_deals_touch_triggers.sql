-- Run this in the Supabase SQL editor. Adds updated_at "last touched"
-- tracking to deals, per the CLAUDE.md "Needs attention" panel spec: stage
-- changes and note/offer additions should bump it, so a deal a sourcer is
-- actively working on doesn't get wrongly flagged as stale.
--
-- Requires deals.updated_at and deals.viewing_date to already exist — see
-- 017_deals_updated_at_and_viewing_date.sql. This file only adds the
-- trigger machinery on top, not the columns.
--
-- Safe to re-run: CREATE OR REPLACE FUNCTION is idempotent by nature, and
-- each trigger is dropped and recreated, matching this repo's existing
-- db/*.sql convention (see 007_deal_notes.sql / 008_deal_offers.sql).
--
-- Verified live against real data (a chosen deal was stage-changed, given a
-- note, given an offer, and had a note deleted): updated_at bumped on the
-- first three and correctly stayed unchanged on the delete (test residue
-- cleaned up afterward — this file itself made no lasting change).

-- 1. deals itself — any UPDATE (rename via deal_data, stage change via
-- pipeline_stage) auto-bumps updated_at. Fires inside the same UPDATE
-- statement server.js already issues — no server.js changes needed.
create or replace function touch_deals_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_deals_touch_updated_at on deals;
create trigger trg_deals_touch_updated_at
  before update on deals
  for each row
  execute function touch_deals_updated_at();

-- 2. deal_notes / deal_offers — an INSERT (a genuine addition) bumps the
-- PARENT deal's updated_at. AFTER INSERT only — deliberately not UPDATE
-- (offer outcome edits) or DELETE (note/offer removal), per the agreed
-- scope: additions and direct deal edits only.
--
-- SECURITY DEFINER + pinned search_path: this needs to update a row in
-- deals regardless of whatever RLS UPDATE policy (if any) applies to the
-- calling user on deals directly — the note/offer's own insert is already
-- correctly RLS-checked (deal_notes/deal_offers' own "insert own..."
-- policies, plus server.js's dealBelongsToRequester() check before either
-- insert), so by the time this trigger fires the write is already
-- known-legitimate. This just guarantees the parent bump always succeeds
-- rather than depending on deals having a matching update policy for this
-- internal housekeeping write. search_path is pinned to public/pg_temp,
-- standard hardening practice for SECURITY DEFINER functions.
create or replace function touch_parent_deal_updated_at()
returns trigger as $$
begin
  update deals set updated_at = now() where id = new.deal_id;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_deal_notes_touch_parent on deal_notes;
create trigger trg_deal_notes_touch_parent
  after insert on deal_notes
  for each row
  execute function touch_parent_deal_updated_at();

drop trigger if exists trg_deal_offers_touch_parent on deal_offers;
create trigger trg_deal_offers_touch_parent
  after insert on deal_offers
  for each row
  execute function touch_parent_deal_updated_at();
