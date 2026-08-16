-- SaleHop database schema
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query -> paste -> Run).
--
-- Design choice for v1: posting a sale does NOT require creating an account.
-- Anyone can submit a listing; it goes in as status = 'pending' and only
-- becomes publicly visible once you approve it from the Supabase dashboard
-- (Table Editor -> sales -> change "status" to "approved"). That dashboard
-- IS the admin panel -- no separate admin app needs to be built to launch.
-- Saved/favorited sales for building a route are kept in the visitor's own
-- browser (no account needed there either). If you later want user
-- accounts (e.g. "my postings", sync favorites across devices), Supabase
-- Auth can be layered in without changing this table structure.

create extension if not exists pgcrypto;

-- ---------- SALES ----------
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  address text not null,
  lat double precision,
  lng double precision,
  sale_date date not null,
  start_time time not null,
  end_time time not null,
  tags text[] not null default '{}',
  description text,
  photo_urls text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists sales_status_date_idx on public.sales (status, sale_date);

alter table public.sales enable row level security;

-- Public (anonymous) visitors can only see approved sales.
create policy "Public can view approved sales"
  on public.sales for select
  to anon, authenticated
  using (status = 'approved');

-- Anyone can submit a new sale; it always starts as 'pending' regardless of
-- what the client sends, so a visitor can't publish directly without review.
create policy "Anyone can submit a sale"
  on public.sales for insert
  to anon, authenticated
  with check (status = 'pending');

-- No public update/delete policy is defined on purpose: moderation
-- (approve / reject / edit / delete) happens from the Supabase dashboard
-- using your project's service role, which bypasses RLS entirely.

-- ---------- STORAGE (sale photos) ----------
insert into storage.buckets (id, name, public)
values ('sale-photos', 'sale-photos', true)
on conflict (id) do nothing;

create policy "Public can view sale photos"
  on storage.objects for select
  using (bucket_id = 'sale-photos');

create policy "Anyone can upload sale photos"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'sale-photos');
