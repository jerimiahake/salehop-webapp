-- SaleHop v9: track free "first sellers" Featured comps
-- Run this once in the Supabase SQL Editor. Safe on top of schema.sql
-- through schema-v8-ad-frequency-setting.sql.
--
-- What this adds:
--   * `featured_comp` on sales -- a plain historical marker, true forever
--     once /admin's "Grant Free Feature" button has been used on a
--     listing, even after that free Featured period ends or is removed.
--     Lets Jerimiah see a real running count of how many free launch
--     comps have actually been given out (e.g. toward a "first 25 real
--     sellers" offer), separate from anyone who later pays the normal
--     $10 via Stripe.
--   * Not guarded by the existing owner-write-blocking trigger the way
--     `featured`/`featured_until` are (schema-v5) -- this column is purely
--     informational for the admin dashboard, doesn't unlock anything on
--     its own, and there's no seller-facing route that could write to it
--     anyway (only /api/admin/sales/[id], which is service-role only).

alter table public.sales add column if not exists featured_comp boolean not null default false;
