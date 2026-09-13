-- SaleHop v11: photos + notes on a spotted sale, verified by location
-- Run this once in the Supabase SQL Editor. Safe on top of schema.sql
-- through schema-v10-spotted-sales.sql.
--
-- What this adds:
--   * Two new columns on `spotted_sales`:
--       - `photo_urls text[]` -- public photo URLs, same shape as
--         `sales.photo_urls`. Capped at 12 in the API route, oldest
--         dropped if a 13th comes in.
--       - `notes jsonb` -- a plain array of {text, created_at} objects
--         (not a separate table -- there's no need to query these on
--         their own, and a spotted sale never has more than a handful).
--         Capped at 10 entries of 300 characters each in the API route,
--         oldest dropped if an 11th comes in.
--     Both show up immediately, no admin approval needed -- see
--     app/api/spotted-sales/[id]/photos/route.js. An admin can still
--     remove an individual photo or note later from /admin if something
--     inappropriate gets added (see app/api/admin/spotted-sales/[id]/route.js).
--   * A new `spotted-sale-photos` storage bucket, public-read like
--     `sale-photos`, but with NO public insert policy -- unlike a real
--     listing's photos (uploaded straight from the browser with the anon
--     key), a spotted-sale photo has to be verified (checked against the
--     photo's own GPS data, or the uploader's live location) and stripped
--     of that GPS data before it's stored, which only the service-role
--     API route can do. Anyone hitting the bucket directly with the anon
--     key can view photos, never upload one.
--
-- Anyone contributing a photo/note has to prove they're actually near the
-- sale first -- either the photo itself has GPS location data taken at
-- the sale, or their phone's live location says they're close enough.
-- Neither works? The upload is rejected outright, not stored as
-- "unverified" -- see the API route for the exact check.

alter table public.spotted_sales add column if not exists photo_urls text[] not null default '{}';
alter table public.spotted_sales add column if not exists notes jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public)
values ('spotted-sale-photos', 'spotted-sale-photos', true)
on conflict (id) do nothing;

-- Postgres has no "create policy if not exists", so this is made
-- re-runnable the same way schema-v3/v4/v8 handle their own policies:
-- drop it first if it's already there, then (re)create it.
drop policy if exists "Public can view spotted sale photos" on storage.objects;
create policy "Public can view spotted sale photos"
  on storage.objects for select
  using (bucket_id = 'spotted-sale-photos');

-- No insert policy on purpose -- every upload goes through
-- app/api/spotted-sales/[id]/photos/route.js using the service role,
-- which bypasses RLS entirely and can do the GPS verification + EXIF
-- stripping first. A visitor's browser never uploads to this bucket
-- directly the way it does for sale-photos.
