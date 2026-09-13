-- SaleHop v15: ad click destination (in-app ad page by default, or link-only)
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New
-- query -> paste -> Run). Safe on top of schema.sql through
-- schema-v14-sale-popularity.sql, and safe to run more than once.
--
-- What this adds:
--   * `ads.link_only` (boolean, default false) -- when true, tapping an
--     "image"-type ad in Browse jumps straight to its link_url in a new
--     tab, the original behavior. When false (the new default), tapping
--     it instead opens the ad's own in-app page (salehop.app/ad/[id] --
--     title, description, image, a "Visit Website" button for its link,
--     and, for a physical-location ad, its address plus the "I'm here!"
--     check-in button and Mayor standing from the badges update). This
--     fixes a real dead-click bug: several physical-location ads seeded
--     via seed_physical_ads.sql have no link_url at all (no website was
--     on file for them), so tapping those cards used to do nothing.
--   * Existing ads all default to `link_only = false`, i.e. they pick up
--     the new in-app-page behavior automatically -- nothing to change
--     unless a specific advertiser should skip straight to their site.

alter table public.ads
  add column if not exists link_only boolean not null default false;
