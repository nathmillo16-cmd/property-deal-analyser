-- Run this in the Supabase SQL editor. Seeds the Tier 1 referral partners
-- from the Referral Business List doc as crm_contacts rows. Requires
-- db/022_crm_contacts.sql to have been run first.
--
-- business_category is deliberately left null for all 10 - I don't have
-- the actual per-business categorisation from that doc, and CLAUDE.md is
-- explicit about never guessing/inventing data. Fill each one in from the
-- contact's edit form once seeded (mortgage_broker/accountant/solicitor/
-- surveyor/builder/letting_agent are the allowed values, per db/022).
--
-- owner_id is left null too - at the time this runs, no profile has
-- role = 'superuser' yet (you set that manually after this ships, per the
-- original spec), so there's no valid Cameron/Nathan id to assign yet.
-- Assign an owner per partner from the CRM UI afterward.
--
-- Guarded with a WHERE NOT EXISTS check per row (matched on name) so
-- re-running this file doesn't create duplicates.

insert into crm_contacts (name, contact_category, stage, business_name, partner_tier)
select v.name, 'referral_partner', 'new', v.name, 1
from (values
  ('Perkins First Financial Solutions'),
  ('Safdar Financial Services'),
  ('Seagrave French'),
  ('Kwan Chan & Co'),
  ('Walton & Allen'),
  ('Miller & Vincent Properties'),
  ('Fairview Estates'),
  ('BHW Conveyancing'),
  ('Bramble & Wagg'),
  ('Onyx Consult')
) as v(name)
where not exists (
  select 1 from crm_contacts c where c.name = v.name and c.contact_category = 'referral_partner'
);
