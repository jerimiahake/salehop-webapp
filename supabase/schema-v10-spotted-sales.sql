-- SaleHop v10: crowdsourced "spotted a sale" reporting
-- Run this once in the Supabase SQL Editor. Safe on top of schema.sql
-- through schema-v9-free-feature-comp.sql.
--
-- What this adds:
--   * `spotted_sales` -- a passerby-reported sale sighting. Anyone (no
--     account needed) can tap "Spot a Sale" on the Map screen while
--     driving by; that captures their current GPS location and either
--     starts a new row here or, if it's close to an existing unconfirmed
--     one, adds to it. Two ways a spotted sale becomes `confirmed`:
--       1. "Crowd" -- enough distinct people report the same spot
--          (spotted_sale_confirm_count in app_settings below, default 3).
--       2. "Visit" -- someone physically drives to an unconfirmed spot
--          (the app prompts them once they're close enough) and taps
--          "Yes, I found it" -- their own current location then replaces
--          the original (likely less precise -- reported from a moving
--          car) location.
--     `reporter_device_ids` is a confidential, service-role-only list of
--     anonymous per-browser ids (see lib/deviceId.js) used only to stop
--     one device from inflating the crowd count by reporting the same
--     spot over and over -- never shown to the public, and the public API
--     never returns it (see app/api/spotted-sales/route.js). Even
--     /admin's own view only ever shows the aggregate count, not the raw
--     ids (see app/api/admin/spotted-sales/route.js).
--   * Two new `app_settings` columns: `spotted_sale_radius_ft` (how close
--     two reports need to be to count as "the same sale," and also how
--     close a visitor needs to get before being prompted to confirm one)
--     and `spotted_sale_confirm_count` (how many distinct reports
--     auto-confirm a spot) -- both adjustable from /admin, same pattern
--     as `ad_interval` in schema-v8.
--
-- `spotted_sales` follows the same "RLS on, zero public policies" pattern
-- as error_reports/contact_messages (schema-v6) -- every public read and
-- write goes through an API route (service role), never straight to
-- Supabase from the client, since the clustering/distance math has to run
-- server-side anyway.

create table if not exists public.spotted_sales (
  id uuid primary key default gen_random_uuid(),
  lat double precision not null,
  lng double precision not null,
  status text not null default 'unconfirmed' check (status in ('unconfirmed', 'confirmed', 'rejected')),
  confirmation_method text check (confirmation_method in ('crowd', 'visit', 'admin')),
  reporter_device_ids text[] not null default '{}',
  first_reported_at timestamptz not null default now(),
  last_reported_at timestamptz not null default now(),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.spotted_sales enable row level security;
-- No select/insert/update policies on purpose -- only the
-- /api/spotted-sales* routes and /admin (all service role) ever touch
-- this table.

alter table public.app_settings add column if not exists spotted_sale_radius_ft int not null default 300;
alter table public.app_settings add column if not exists spotted_sale_confirm_count int not null default 3;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_spotted_radius_check') then
    alter table public.app_settings
      add constraint app_settings_spotted_radius_check check (spotted_sale_radius_ft >= 50 and spotted_sale_radius_ft <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_settings_spotted_confirm_count_check') then
    alter table public.app_settings
      add constraint app_settings_spotted_confirm_count_check check (spotted_sale_confirm_count >= 2 and spotted_sale_confirm_count <= 10);
  end if;
end $$;
