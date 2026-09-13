-- SaleHop v13: badges, check-ins, and a lightweight buyer "player" profile
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New
-- query -> paste -> Run). Safe on top of schema.sql through
-- schema-v12-ad-ownership.sql, and safe to run more than once.
--
-- What this adds:
--   * `players` -- one row per anonymous visitor, keyed by the same
--     per-browser `deviceId` already used for crowdsourced spotted-sale
--     reporting (lib/deviceId.js) -- NOT a real login. Starts with just a
--     device_id; email/phone/username are added later, progressively, the
--     first time that visitor earns a badge (see BadgeUnlockModal.js) --
--     this is deliberately a soft, no-password way to slowly build a
--     contact list from engaged visitors, not a real account system.
--   * `player_activity` -- an append-only log of badge-relevant actions
--     (spotting a sale, confirming one, contributing a photo, checking in
--     at a sale or a recurring physical-location ad, posting a sale) used
--     to compute which badges (lib/badges.js) a device has earned. No
--     foreign keys to other tables on purpose -- activity can reference a
--     sale, an ad, or a spotted sale, and rows should never disappear
--     just because something they reference later gets deleted.
--   * `app_settings.checkin_radius_ft` -- how close (in feet) a visitor
--     has to actually be to a sale/ad's pin before "📍 I'm here!" is
--     allowed to work, same anti-spoof shape as the existing spotted-sale
--     confirm radius.
--   * A small fix: schema-v8's `app_settings_ad_interval_check` constraint
--     still required `ad_interval >= 1`, left over from before "Ad
--     Frequency = 0 (show every ad)" was added -- saving 0 from /admin
--     would have failed at the database level even though the app
--     validation already allowed it. Widened to `>= 0` here.
--
-- Nobody's real identity (name, address, etc.) lives in `players` beyond
-- whatever a visitor voluntarily typed into the badge-unlock prompt --
-- same trust model as the existing contact form.

-- ---------- 0. Fix: Ad Frequency = 0 needs to be allowed at the DB level too ----------
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'app_settings_ad_interval_check') then
    alter table public.app_settings drop constraint app_settings_ad_interval_check;
  end if;
  alter table public.app_settings
    add constraint app_settings_ad_interval_check check (ad_interval >= 0 and ad_interval <= 50);
end $$;

-- ---------- 1. How close counts as "there" for a check-in ----------
alter table public.app_settings
  add column if not exists checkin_radius_ft int not null default 300;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_checkin_radius_check') then
    alter table public.app_settings
      add constraint app_settings_checkin_radius_check check (checkin_radius_ft >= 50 and checkin_radius_ft <= 2000);
  end if;
end $$;

-- ---------- 2. Players (anonymous by default) ----------
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  device_id text not null unique,
  username text,
  email text,
  phone text,
  marketing_opt_in boolean not null default false,
  -- Best-effort link if this same browser is ALSO a signed-in seller when
  -- they claim their profile -- lets one person's buyer + seller badges
  -- show together. Never required, never backfilled after the fact.
  linked_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists players_linked_user_id_idx on players (linked_user_id) where linked_user_id is not null;

-- Case-insensitive uniqueness ("Bob" and "bob" can't both claim the
-- leaderboard) via a functional index rather than a plain `unique`
-- constraint on the column itself.
create unique index if not exists players_username_unique_idx on players (lower(username)) where username is not null;

alter table public.players enable row level security;
-- No public policy on purpose -- email/phone/device_id are confidential.
-- Everything reads/writes through app/api/players/* and app/api/checkins,
-- which use the service-role connection (same pattern as spotted_sales).

-- ---------- 3. Activity log (what earns a badge) ----------
create table if not exists public.player_activity (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  -- 'spotted_report', 'spotted_confirmed_own', 'photo_contributed',
  -- 'sale_visited', 'ad_visited', 'sale_posted' -- see lib/badges.js.
  activity_type text not null,
  -- Free-form: a sale/ad/spotted-sale id, or (for a recurring ad
  -- check-in) "<adId>:<yyyy-mm-dd>" so repeat visits on different days
  -- each count once toward that ad's Mayor standing without letting one
  -- visit be replayed for extra credit the same day. No foreign key --
  -- see note above.
  ref_id text,
  occurred_at timestamptz not null default now()
);

create index if not exists player_activity_device_idx on player_activity (device_id);
create index if not exists player_activity_type_ref_idx on player_activity (activity_type, ref_id);

alter table public.player_activity enable row level security;
-- No public policy -- written only by app/api/checkins, the spotted-sales
-- routes, and app/api/players/track-sale-posted, all via service role.
