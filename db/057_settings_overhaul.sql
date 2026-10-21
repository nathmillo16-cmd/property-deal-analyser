-- Run this in the Supabase SQL editor. Settings overhaul (settings.html):
-- surname and phone, the wider investment defaults, Company & letters
-- (with a small logo), notification toggles, and the refurb region saved
-- to the account instead of the device.
--
-- Additive only: new nullable columns. Nothing is renamed or dropped.
-- target_yield, target_roi, letter_sender and target_ltv all stay where
-- they are (target_ltv simply becomes "Refinance LTV" in Settings, so its
-- value carries over with no move).
--
-- Safe to re-run: IF NOT EXISTS everywhere, constraints are dropped and
-- recreated, and each copy-over below only fills a value that is still
-- empty (the buy box copy is also marked done, so it never runs twice for
-- the same person).
--
-- The app keeps working before this is run: Settings shows the new
-- sections but says they need a quick database update before saving.

-- ---------- profiles: account details ----------
alter table profiles add column if not exists surname text;
alter table profiles add column if not exists phone text;
alter table profiles drop constraint if exists profiles_surname_len;
alter table profiles add constraint profiles_surname_len check (surname is null or char_length(surname) <= 80);
alter table profiles drop constraint if exists profiles_phone_len;
alter table profiles add constraint profiles_phone_len check (phone is null or char_length(phone) <= 40);

-- ---------- profiles.calc_defaults ----------
-- The investment defaults that have no column of their own, e.g.
-- {"buying_as":"ltd","tax_band":"basic","survey":450,"broker_fee":500,
--  "mortgage_product":"interest_only","stress_rate":5.5,"icr":125,
--  "bridge_monthly_rate":0.85,"bridge_arrangement_pct":2,"bridge_exit_pct":0,
--  "voids_pct":4,"letting_fee":300,"safety_certs":250}
-- Every key is optional: missing means "use the built-in default".
-- Validated by the server. Covered by the existing profiles RLS.
alter table profiles add column if not exists calc_defaults jsonb;
alter table profiles drop constraint if exists profiles_calc_defaults_object;
alter table profiles add constraint profiles_calc_defaults_object check (calc_defaults is null or jsonb_typeof(calc_defaults) = 'object');

-- ---------- profiles.company_details and company_logo ----------
-- Company & letters: {"name","number","address","phone","email"}, used by
-- Letter Templates ("From you"), the scope of works PDF and future PDFs.
-- The logo is a small PNG or JPEG kept as a data URL in its own column, so
-- it never rides along on the everyday profile request. The server shrinks
-- nothing: the browser resizes it before upload and the server caps it.
alter table profiles add column if not exists company_details jsonb;
alter table profiles drop constraint if exists profiles_company_details_object;
alter table profiles add constraint profiles_company_details_object check (company_details is null or jsonb_typeof(company_details) = 'object');
alter table profiles add column if not exists company_logo text;
alter table profiles drop constraint if exists profiles_company_logo_shape;
alter table profiles add constraint profiles_company_logo_shape check (
  company_logo is null
  or (company_logo ~ '^data:image/(png|jpeg);base64,' and char_length(company_logo) <= 400000)
);

-- ---------- profiles.notification_prefs ----------
-- In-app only (Home's Needs attention), no emails:
-- {"fix_ending":true,"compliance":true,"loan_repayments":true,"follow_ups":true}
-- A missing key means on.
alter table profiles add column if not exists notification_prefs jsonb;
alter table profiles drop constraint if exists profiles_notification_prefs_object;
alter table profiles add constraint profiles_notification_prefs_object check (notification_prefs is null or jsonb_typeof(notification_prefs) = 'object');

-- ---------- refurb_rate_cards.region ----------
-- The region used for indicative refurb guide rates, saved to the account
-- (it used to live only in the browser). Kept with the rate card itself.
do $$
begin
  if to_regclass('public.refurb_rate_cards') is not null then
    alter table refurb_rate_cards add column if not exists region text;
    alter table refurb_rate_cards alter column rates set default '{}'::jsonb;
    if not exists (select 1 from pg_constraint where conname = 'refurb_rate_cards_region_len') then
      alter table refurb_rate_cards add constraint refurb_rate_cards_region_len check (region is null or char_length(region) <= 60);
    end if;
  end if;
end $$;

-- ---------- copy-over 1: target yield / ROI into an empty buy box ----------
-- Target yield becomes the buy box's minimum gross yield and target ROI its
-- minimum cash-on-cash return, only when the buy box has nothing in it yet.
-- Marked done in calc_defaults so a buy box the user later clears on
-- purpose is never refilled by a re-run. target_yield/target_roi are left
-- in place, untouched.
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'buy_box') then
    update profiles p
    set buy_box = coalesce(p.buy_box, '{}'::jsonb)
          || jsonb_build_object('strategies', coalesce(p.buy_box->'strategies', '[]'::jsonb),
                                'property_types', coalesce(p.buy_box->'property_types', '[]'::jsonb),
                                'areas', coalesce(p.buy_box->'areas', '[]'::jsonb),
                                'min_yield', to_jsonb(p.target_yield),
                                'min_coc', to_jsonb(p.target_roi))
    where (p.target_yield is not null or p.target_roi is not null)
      and coalesce((p.calc_defaults->>'targets_moved_to_buy_box')::boolean, false) = false
      and (p.buy_box is null or not exists (
            select 1 from jsonb_each(p.buy_box) e
            where e.value not in ('null'::jsonb, '[]'::jsonb, '""'::jsonb)));

    update profiles p
    set calc_defaults = coalesce(p.calc_defaults, '{}'::jsonb) || '{"targets_moved_to_buy_box":true}'::jsonb
    where coalesce((p.calc_defaults->>'targets_moved_to_buy_box')::boolean, false) = false;
  end if;
end $$;

-- ---------- copy-over 2: Letter Templates "From you" into Company & letters ----------
-- Address, phone and email move across when Company & letters is still
-- empty. A "First Last" name fills the surname (and the first name if that
-- is blank) when it matches. letter_sender itself stays as it is: Letter
-- Templates still keeps "Your area" and the two tick boxes there.
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'letter_sender') then
    update profiles p
    set company_details = jsonb_strip_nulls(jsonb_build_object(
          'address', nullif(btrim(p.letter_sender->>'address'), ''),
          'phone',   nullif(btrim(p.letter_sender->>'phone'), ''),
          'email',   nullif(btrim(p.letter_sender->>'email'), '')))
    where p.company_details is null
      and jsonb_typeof(p.letter_sender) = 'object'
      and coalesce(nullif(btrim(p.letter_sender->>'address'), ''), nullif(btrim(p.letter_sender->>'phone'), ''), nullif(btrim(p.letter_sender->>'email'), '')) is not null;

    update profiles p
    set surname = left(btrim(substr(btrim(p.letter_sender->>'name'), strpos(btrim(p.letter_sender->>'name'), ' ') + 1)), 80),
        name = coalesce(nullif(btrim(p.name), ''), split_part(btrim(p.letter_sender->>'name'), ' ', 1))
    where p.surname is null
      and jsonb_typeof(p.letter_sender) = 'object'
      and strpos(btrim(coalesce(p.letter_sender->>'name', '')), ' ') > 0
      and (nullif(btrim(p.name), '') is null
           or lower(btrim(p.name)) = lower(split_part(btrim(p.letter_sender->>'name'), ' ', 1)));
  end if;
end $$;
