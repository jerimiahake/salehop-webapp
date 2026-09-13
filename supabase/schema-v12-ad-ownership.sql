-- SaleHop v12: advertiser self-edit accounts
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New
-- query -> paste -> Run). Safe to run on top of schema.sql through
-- schema-v11-spotted-sale-details.sql, and safe to run more than once.
--
-- What this adds:
--   * An `owner_email` column on `ads` -- set from /admin (see the new
--     "Owner email" field on the ad create/edit form) to hand one specific
--     ad over to a business owner. Nothing changes for any ad that's left
--     without one -- those stay 100% admin-only, exactly as before.
--   * Once an ad has an owner_email, that business can sign in using the
--     exact same magic-link/password account system sellers already use
--     (Account tab -> enter that email -> sign in) and see + edit their
--     own ad from a new "My Ad" section there. No separate advertiser
--     signup flow needed, and no lookup step for Jerimiah -- typing the
--     business's email into /admin is the whole setup.
--   * Ownership is matched by email at query time (`auth.jwt() ->>
--     'email'`), not by a stored user_id -- so this works the very first
--     time that business signs in, with nothing to link up beforehand.
--   * A trigger blocks an advertiser from changing their own
--     `owner_email`, `ad_type`, `html_snippet`, or `active` -- only the
--     admin panel's service-role connection can touch those. Without this,
--     a technically-savvy advertiser could re-point their ad at a
--     different email (locking Jerimiah out of managing it), turn an
--     "image" ad into a raw "snippet" ad and inject arbitrary HTML/JS, or
--     toggle their own ad on/off outside of however Jerimiah bills for it.
--     Everything else about the ad (title, description, image, link,
--     sponsor name, location) stays editable by its owner.

-- ---------- 1. Who owns this ad, if anyone ----------
alter table public.ads
  add column if not exists owner_email text;

-- Case-insensitive lookups (auth.jwt() ->> 'email' and whatever casing
-- Jerimiah happens to type into /admin) without scanning every row.
create index if not exists ads_owner_email_idx on public.ads (lower(owner_email));

-- ---------- 2. Owners can view and update their own ad ----------
-- (The existing "Public can view active ads" policy from schema-v3 stays
-- as-is -- Postgres OR's multiple SELECT policies together, so this just
-- adds visibility into your own ad even while it's inactive, e.g. between
-- Jerimiah creating it and activating it.)
drop policy if exists "Owners can view their own ad" on public.ads;
drop policy if exists "Owners can update their own ad" on public.ads;

create policy "Owners can view their own ad"
  on public.ads for select
  to authenticated
  using (owner_email is not null and lower(owner_email) = lower(auth.jwt() ->> 'email'));

create policy "Owners can update their own ad"
  on public.ads for update
  to authenticated
  using (owner_email is not null and lower(owner_email) = lower(auth.jwt() ->> 'email'))
  with check (owner_email is not null and lower(owner_email) = lower(auth.jwt() ->> 'email'));

-- Still no public insert/delete policy -- an ad can only ever be created
-- or deleted from /admin (service-role connection, bypasses RLS), an
-- owner can only ever edit one that already exists and is already theirs.

-- ---------- 3. Protect the fields an owner shouldn't be able to touch ----------
create or replace function public.ads_protect_owner_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    if new.owner_email is distinct from old.owner_email then
      new.owner_email := old.owner_email;
    end if;
    if new.ad_type is distinct from old.ad_type then
      new.ad_type := old.ad_type;
    end if;
    if new.html_snippet is distinct from old.html_snippet then
      new.html_snippet := old.html_snippet;
    end if;
    if new.active is distinct from old.active then
      new.active := old.active;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ads_protect_owner_fields on public.ads;

create trigger ads_protect_owner_fields
  before update on public.ads
  for each row
  execute function public.ads_protect_owner_fields();
