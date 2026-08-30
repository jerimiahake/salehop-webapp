-- SaleHop v6: visibility into failed signups/listings, plus a contact form.
-- Run this once in the Supabase SQL Editor. Safe on top of schema.sql
-- through schema-v5-featured-listings.sql.
--
-- What this adds:
--   * `error_reports` -- a quiet log of failures that happen entirely in
--     the visitor's browser (a magic-link signup that errored, or a
--     listing submission that failed partway through) and would otherwise
--     never reach Jerimiah at all. The app calls POST /api/log-error from
--     inside a catch block whenever one of those happens; that route uses
--     the service-role connection to insert here, and /admin reads it
--     back the same way. Nothing about this is visitor-facing.
--   * `contact_messages` -- messages submitted through the public /contact
--     page. Saved here first (the guaranteed record), then a best-effort
--     email notification is sent; `email_sent` records whether that part
--     worked, so a failed email never means a lost message -- it just
--     shows up unread in /admin instead of an inbox.
--
-- Both tables follow the same "RLS on, zero policies" pattern already used
-- for feature_purchases in schema-v5: only the service-role connection
-- (used by the API routes above and by /admin) can read or write these --
-- anonymous and signed-in visitors get nothing directly from Supabase.

-- ---------- 1. Error reports ----------
create table if not exists public.error_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('signup', 'listing')),
  message text not null,
  email text,
  context jsonb,
  resolved boolean not null default false
);

alter table public.error_reports enable row level security;
-- No select/insert/update policies on purpose -- only POST /api/log-error
-- (service role) and /admin (service role) ever touch this table.

-- ---------- 2. Contact messages ----------
create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  email text not null,
  message text not null,
  email_sent boolean not null default false,
  resolved boolean not null default false
);

alter table public.contact_messages enable row level security;
-- No select/insert/update policies on purpose -- only POST /api/contact
-- (service role) and /admin (service role) ever touch this table.
