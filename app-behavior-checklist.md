# SaleHop — "did everything load?" checklist

There are two separate things that each update needed: a **database
change** (run once in Supabase's SQL Editor) and a **code change** (the
`.ps1` script committing + pushing, which Vercel then deploys). The SQL
checker below only tells you about the database half. Use this list to
spot-check the code/live-site half for each feature.

## 1. Run the database checklist first
Open your Supabase project → SQL Editor → New query, paste in
`check-migrations.sql` (in your project's `supabase` folder), and click
Run. Every row should say `t` (true = applied). Any row saying `f`
(false) means that update's SQL Editor step hasn't been run yet — open
the matching file (same name, in the same folder) and run it.

## 2. Then spot-check each feature actually works on salehop.app
Quick, no-typing checks — just look for these on the live site:

- **Multi-day sales**: posting a listing shows a "This sale runs multiple
  days" checkbox.
- **Featured listings**: My Listings shows a "Feature — $10" button on
  your own listing.
- **Admin Support section**: `/admin` has a Support section near the
  bottom (even if empty).
- **Physical-location ads**: any Goodwill/thrift-shop ad in Browse shows
  an address and a favorite star instead of "Sponsored by."
- **Ad Frequency**: `/admin` → Ads section has an "Ad frequency" number
  box near the top.
- **Free Feature comps**: a listing row in `/admin` has a "🎁 Grant Free
  Feature" button.
- **Spotted sales**: the Map screen has a "🚩 Spot a Sale" button.
- **Spotted sale photos**: opening a spotted sale (from Browse or its map
  pin) shows a way to add a photo/note, not just a plain popup.
- **Advertiser self-edit / My Ad**: `/admin`'s Add/Edit Ad form has an
  "Owner email" field.
- **Badges / check-ins**: Your Account screen has a "🏅 My Badges" card,
  and an open sale's detail sheet has an "I'm here!" check-in button.
- **Ad link destination (the newest fix)**: tapping any image-type ad
  (not a physical-location one) opens the ad's own page in a new tab
  (title/image/"Visit Website" button) instead of jumping straight to a
  website — and `/admin`'s Add/Edit Ad form has a "Link only" checkbox
  under the link field.

If a database row says `t` but the matching item above isn't there on the
live site, that update's `.ps1` script either wasn't run or didn't finish
— re-run it. If a database row says `f`, the SQL Editor step for that one
is what's missing, even if the button/field somehow shows up (it just
won't save anything until the column exists).

Not on this list on purpose: the sale-popularity/"trending" fire badge
feature. That one is still being built and hasn't been delivered to you
yet, so there's nothing to check for it.
