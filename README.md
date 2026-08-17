# SaleHop

A mobile-first garage sale finder: browse and search sales near you, drop
pins on a map, build a route by favoriting stops, export that route straight
into Google Maps or Apple Maps, and post your own sale through a moderated
submission form. Sellers sign in (passwordless, via a magic-link email) to
manage their own listings, and a password-protected `/admin` dashboard is
where you moderate everything.

Built with:
- **Next.js** (React) for the app itself
- **Supabase** (free tier) for the database, photo storage, auth, and the service-role connection behind `/admin`
- **Leaflet + OpenStreetMap** for the map (free, no API key/billing)
- **Nominatim** (OpenStreetMap) for geocoding and as-you-type address suggestions (free, no API key)

Total cost to run this: **$0**, aside from your domain name, until you outgrow Supabase's free tier (500MB database, 1GB file storage, 50k monthly active users -- generous for a local/regional garage sale site).

---

## 1. Run it locally (preview mode, no setup required)

```bash
npm install
npm run dev
```

Open http://localhost:3000. Without any further setup, the app runs on
built-in sample data (`lib/sampleData.js`) so you can click around
immediately -- Browse, Map, and Saved all work. Post and Account require a
real Supabase connection (step 2) since they need somewhere to sign in
against.

## 2. Connect Supabase (free) -- this is your database, auth, and (with the admin panel) moderation backend

1. Go to https://supabase.com, sign up free, and create a new project.
2. Open **SQL Editor** in the left sidebar. Run these two files, in order,
   pasting each one's full contents and clicking **Run**:
   - `supabase/schema.sql` -- creates the `sales` table, base security
     rules, and the `sale-photos` storage bucket.
   - `supabase/schema-v2-accounts.sql` -- adds seller accounts: links each
     sale to the account that posted it, lets sellers view/edit/delete
     their own listings, and blocks a seller from self-approving a listing
     (only the admin panel's service-role connection can change `status`).
3. Open **Project Settings -> API**. You'll need three values from here:
   - **Project URL**
   - **anon / public** key (safe to expose to visitors' browsers)
   - **service_role / secret** key (full database access -- treat this like
     a master password; it's only ever used server-side, never sent to a
     browser)
4. Open **Authentication -> URL Configuration** and set:
   - **Site URL**: your production URL (e.g. `https://salehop.app`)
   - **Redirect URLs**: add `https://salehop.app/**` (and, while testing
     locally, `http://localhost:3000/**`)

   This is what makes the magic-link sign-in email land back on your actual
   site instead of somewhere unexpected.
5. In this project, copy `.env.local.example` to a new file named
   `.env.local`, and fill in all five values (see that file for exactly
   which env var each one goes in).
6. Restart `npm run dev`. The app now reads/writes real data, and Post/
   Account will work.

### Seller accounts ("My Listings")

Posting a sale requires signing in first -- tap **Account**, enter an
email, and a one-click sign-in link is emailed (no password to create or
remember). Once signed in, sellers see their own listings under **Account**
regardless of status, and can **Edit** or **Delete** them at any time. Edits
go live immediately without needing re-approval.

### The admin panel

New listings are inserted with `status = 'pending'` and aren't shown
publicly until approved. Moderate at **`https://your-site/admin`**,
protected by the `ADMIN_PASSWORD` you set below. From there you can filter
by status, Approve/Reject with one click, Edit any field, or permanently
Delete a listing (including its uploaded photos). The Supabase Table Editor
still works too, as a fallback -- both talk to the same table.

## 3. Deploy (free) -- Vercel

1. Push this project to a GitHub repo (Vercel deploys straight from GitHub).
2. Go to https://vercel.com, sign up free, and click **Add New -> Project**,
   then import that repo.
3. In the project's **Environment Variables** settings, add:
   - `NEXT_PUBLIC_SUPABASE_URL` -- Supabase Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` -- Supabase anon/public key
   - `SUPABASE_SERVICE_ROLE_KEY` -- Supabase service_role/secret key
     (**no** `NEXT_PUBLIC_` prefix -- this one must stay server-only)
   - `ADMIN_PASSWORD` -- whatever password you want to log into `/admin` with
   - `ADMIN_SESSION_SECRET` -- a long random string used to sign the admin
     login cookie (not a password you need to remember -- generate one and
     paste it in, e.g. from https://1password.com/password-generator or
     any "random string generator," 40+ characters)
4. Deploy. Vercel gives you a free `*.vercel.app` URL immediately.

## 4. Connect your domain

1. In the Vercel project, go to **Settings -> Domains** and add your domain
   (e.g. `salehop.app`).
2. Vercel will show you the exact DNS record(s) to add (usually an A record
   or CNAME).
3. At your domain registrar (wherever you bought the domain), find the DNS
   settings and add those records -- if the registrar's setup wizard asks
   "point to an external host," that's the option that applies here (not
   "install WordPress" or anything registrar-hosted).
4. DNS changes can take a few minutes to a few hours to take effect.
   Vercel issues HTTPS automatically once it verifies the domain -- which
   matters here since `.app` domains require HTTPS to load at all.
5. Double check step 2.4 above (Supabase's Site URL / Redirect URLs) point
   at this same domain, or magic-link emails will send people to the wrong
   place.

## 5. Adjust the map's default center

`lib/sampleData.js` has a `CENTER` coordinate used only for sample data and
as a fallback map center before a visitor's location loads. Update it to
your own town/region so the map starts in the right place for first-time
visitors before geolocation kicks in.

---

## What's already built

- **Browse** -- searchable list of approved sales for the next 7 days
  (Today, Tomorrow, then day names), sorted by distance from the visitor.
- **Map** -- Leaflet map with custom pins matching the original mockup's
  hand-lettered sign style, tap-to-preview cards, and a route line between
  favorited stops.
- **Post** -- title, address (as-you-type suggestions plus auto-geocoding
  to a map pin), date, hours, category tags, up to 6 photos, and a
  description. Requires signing in; submissions are held for approval.
- **Account** -- passwordless (magic-link) sign in, and a "My Listings"
  view to edit or delete your own sales.
- **Saved** -- your favorited stops (stored in your browser, no account
  needed for this part), reorderable with up/down controls, with a mini
  route map and **"Open in Google Maps" / "Open in Apple Maps"** buttons
  (`lib/mapsExport.js`, capped at 10 stops per Google's free routing URL).
- **/admin** -- password-protected dashboard to Approve/Reject/Edit/Delete
  any listing.
- Installable as a home-screen app (`manifest.json` + icons) as a stepping
  stone toward a full native app later.

## What's intentionally simple for v1 (and easy to extend)

- The admin password is a single shared secret, not a full user-role
  system -- fine for one admin (you); if you ever want multiple admin
  logins with individual passwords, that's a bigger change (Supabase Auth
  + an `is_admin` flag) I can build when it's actually needed.
- Photo storage has no automatic resizing/compression yet; large photo
  uploads will use more of Supabase's free storage tier faster than
  compressed ones would.
- Supabase's default email sending (used for magic links) is rate-limited
  on the free tier -- fine for a small local site's volume, but if sign-in
  emails ever start feeling slow or capped, connecting a custom SMTP
  provider in Supabase's Auth settings removes that limit.
