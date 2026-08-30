-- SaleHop v7: ads with a real physical location can be favorited and
-- added to a buyer's route, same as a garage sale.
-- Run this once in the Supabase SQL Editor. Safe on top of schema.sql
-- through schema-v6-error-reports-and-contact.sql.
--
-- What this adds:
--   * `location_type` on ads -- 'online' (default, unchanged behavior --
--     no address, not favoritable) or 'physical' (a real place like a
--     Goodwill or Habitat ReStore, with an address geocoded the same way
--     a sale's address is).
--   * `address` / `lat` / `lng` columns, only ever populated for
--     'physical' ads. Nullable, since most ads will stay online-only.
--
-- Nothing here changes existing ads -- every current row defaults to
-- 'online' with no address, which behaves exactly as it did before this
-- migration (shown in Browse, no favorite star, never on the map).

alter table public.ads
  add column if not exists location_type text not null default 'online';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ads_location_type_check') then
    alter table public.ads
      add constraint ads_location_type_check check (location_type in ('online', 'physical'));
  end if;
end $$;

alter table public.ads add column if not exists address text;
alter table public.ads add column if not exists lat double precision;
alter table public.ads add column if not exists lng double precision;
