-- SaleHop v8: adjustable ad frequency setting
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New
-- query -> paste -> Run). Safe on top of schema.sql through
-- schema-v7-locatable-ads.sql.
--
-- What this adds:
--   * A tiny single-row `app_settings` table holding `ad_interval` -- how
--     often an ad card is mixed into the Browse list (every Nth real
--     listing). This was previously a hardcoded constant
--     (`AD_INTERVAL` in components/BrowseScreen.js) -- this migration lets
--     it be changed from /admin instead, no code deploy needed.
--   * Public read access (same pattern as `ads`/`tags`) so the live app can
--     fetch the current interval directly via the anon client. No public
--     write policy -- only ever changed from /admin, which uses the
--     service-role connection and bypasses RLS entirely.

create table if not exists public.app_settings (
  id int primary key default 1,
  ad_interval int not null default 4
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_singleton') then
    alter table public.app_settings
      add constraint app_settings_singleton check (id = 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_settings_ad_interval_check') then
    alter table public.app_settings
      add constraint app_settings_ad_interval_check check (ad_interval >= 1 and ad_interval <= 50);
  end if;
end $$;

-- Seed the single settings row if it doesn't exist yet -- matches the
-- previous hardcoded default of 4 so nothing changes until Jerimiah
-- actually adjusts it from /admin.
insert into public.app_settings (id, ad_interval)
values (1, 4)
on conflict (id) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "Public can view app settings" on public.app_settings;

create policy "Public can view app settings"
  on public.app_settings for select
  to anon, authenticated
  using (true);
