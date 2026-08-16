# SaleHop

A mobile-first garage sale finder: browse and search sales near you, drop
pins on a map, build a route by favoriting stops, export that route straight
into Google Maps or Apple Maps, and post your own sale through a
moderated submission form.

Built with:
- **Next.js** (React) for the app itself
- **Supabase** (free tier) for the database, photo storage, and admin panel
- **Leaflet + OpenStreetMap** for the map (free, no API key/billing)
- **Nominatim** (OpenStreetMap) for turning a posted address into map coordinates (free, no API key)

Total cost to run this: **$0**, aside from your domain name, until you outgrow Supabase's free tier (500MB database, 1GB file storage, 50k monthly active users -- generous for a local/regional garage sale site).

---

## 1. Run it locally (preview mode, no setup required)

```bash
npm install
npm run dev
```

Open http://localhost:3000. Without any further setup, the app runs on
built-in sample data (`lib/sampleData.js`) so you can click around
immediately -- Browse, Map, Post, and Saved all work, though posting a sale
in this mode won't actually save anywhere (you'll see a note that it's in
preview mode).

> **Note on this build:** this project was scaffolded in a sandboxed
> environment that couldn't reach the npm registry, so `npm install` /
> `npm run dev` have not actually been executed yet. Every file was written
> carefully and the non-UI logic (the Google/Apple Maps route export and the
> date/time helpers) was independently tested and confirmed correct, but the
> very first real build of the full app will happen when you run the
> commands above (or when Vercel builds it in step 3). If anything doesn't
> compile, paste the error back to me and I'll fix it immediately.

## 2. Connect Supabase (free) -- this is your database + admin panel

1. Go to https://supabase.com, sign up free, and create a new project.
2. Once it's ready, open **SQL Editor** in the left sidebar, paste in the
   entire contents of `supabase/schema.sql` from this project, and click
   **Run**. This creates the `sales` table, sets up the security rules, and
   creates a `sale-photos` storage bucket.
3. Open **Project Settings -> API**. Copy the **Project URL** and the
   **anon / public** key.
4. In this project, copy `.env.local.example` to a new file named
   `.env.local`, and paste those two values in:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
   ```
5. Restart `npm run dev`. The app now reads/writes real data.

### This is your admin panel

Anyone can submit a sale from the Post tab -- it's inserted with
`status = 'pending'` and is **not shown publicly** until you approve it.

To moderate: in the Supabase dashboard, go to **Table Editor -> sales**.
Each row has a `status` column. Change it to `approved` to publish the
listing, or `rejected` to keep it hidden. That's it -- no separate admin
app needed. You can also edit any field, delete spam, or export everything
to CSV right from that screen.

If you later want a nicer in-app "Approve / Reject" button screen instead
of using the Supabase table view, that's a small addition I can build on
top of this whenever you want it.

## 3. Deploy (free) -- Vercel

1. Push this project to a GitHub repo (Vercel deploys straight from GitHub).
2. Go to https://vercel.com, sign up free, and click **Add New -> Project**,
   then import that repo.
3. In the project's **Environment Variables** settings, add the same two
   variables from your `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
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

## 5. Adjust the map's default center

`lib/sampleData.js` has a `CENTER` coordinate used only for sample data and
as a fallback map center before a visitor's location loads. Update it to
your own town/region so the map starts in the right place for first-time
visitors before geolocation kicks in.

---

## What's already built

- **Browse** -- searchable, day-filtered (Fri/Sat/Sun) list of approved
  sales, sorted by distance from the visitor (uses browser geolocation,
  with a graceful fallback if it's denied).
- **Map** -- Leaflet map with custom pins matching the original mockup's
  hand-lettered sign style, tap-to-preview cards, and a route line between
  favorited stops.
- **Post** -- title, address (auto-geocoded to a map pin on submit), date
  (quick Fri/Sat/Sun or a custom date), hours, category tags, up to 6
  photos, and a description. Submissions are held for approval.
- **Saved** -- your favorited stops (stored in your browser, no account
  needed), reorderable with up/down controls, with a mini route map and
  **"Open in Google Maps" / "Open in Apple Maps"** buttons that hand your
  whole multi-stop route to the maps app in one tap (`lib/mapsExport.js`).
  Routes are capped at 10 stops, which is what Google's free routing URL
  supports without an API key/billing.
- Installable as a home-screen app (`manifest.json` + icons) as a stepping
  stone toward a full native app later -- the same Supabase backend can
  serve a React Native or Capacitor-wrapped version down the road without
  any backend changes.

## What's intentionally simple for v1 (and easy to extend)

- No user accounts -- posting doesn't require signing up, and "favorites"
  live in the visitor's own browser rather than syncing across devices.
  Supabase Auth can be added later without restructuring anything.
- Moderation is the Supabase Table Editor rather than a custom "Approve"
  button inside the app -- fully functional, just not custom-branded.
- Photo storage has no automatic resizing/compression yet; large photo
  uploads will use more of Supabase's free storage tier faster than
  compressed ones would.
