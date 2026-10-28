-- 060: viewing mode (viewing.html). Photos can be tagged to the room they
-- were taken in. Additive and nullable: existing photos stay untagged and
-- the server falls back to untagged photos if this hasn't been run yet.
-- The room-by-room checklist itself lives in the existing
-- deals.viewing_checklist jsonb column (db/045), so no other change.
alter table public.deal_photos add column if not exists room text;

alter table public.deal_photos drop constraint if exists deal_photos_room_check;
alter table public.deal_photos add constraint deal_photos_room_check
  check (room is null or room ~ '^[a-z0-9_-]{1,40}$');
