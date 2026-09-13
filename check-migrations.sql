-- SaleHop: "have I run everything?" checklist
--
-- Paste this whole thing into Supabase SQL Editor (Project -> SQL Editor ->
-- New query -> paste -> Run) and read the results table. It checks, for
-- every database update delivered so far, whether the specific
-- table/column it adds actually exists in YOUR database -- so you get a
-- plain Applied / NOT RUN YET answer for each one instead of having to
-- remember which scripts you ran and when.
--
-- This only checks the DATABASE side (the Supabase SQL Editor steps). It
-- can't see whether you've also run the matching .ps1 code-update script
-- for each feature -- those two are separate steps for most updates. If a
-- row here says Applied but the matching feature doesn't actually show up
-- on the live site, the code half is what's missing; re-run that update's
-- .ps1 script.
--
-- Safe to run any time, as often as you like -- it only reads, never
-- changes anything.

select * from (
  values
    (1, 'schema.sql', 'Base sales table', (select exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'sales'
    ))),
    (2, 'schema-v2-accounts.sql', 'Seller accounts', (select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'sales' and column_name = 'user_id'
    ))),
    (3, 'schema-v3-ads-and-neighborhoods.sql', 'Ads table + neighborhood sales', (select
      exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'ads')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales' and column_name = 'is_neighborhood_sale')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales' and column_name = 'neighborhood_name')
    )),
    (4, 'schema-v4-multiday-tags-adtypes.sql', 'Multi-day sales, listing tags, ad types', (select
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales' and column_name = 'end_date')
      and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'tags')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ads' and column_name = 'ad_type')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ads' and column_name = 'html_snippet')
    )),
    (5, 'schema-v5-featured-listings.sql', 'Featured listings ($10 via Stripe)', (select
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales' and column_name = 'featured')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales' and column_name = 'featured_until')
      and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'feature_purchases')
    )),
    (6, 'schema-v6-error-reports-and-contact.sql', 'Admin Support: error reports + contact form', (select
      exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'error_reports')
      and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'contact_messages')
    )),
    (7, 'schema-v7-locatable-ads.sql', 'Favoritable/routable physical-location ads', (select
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ads' and column_name = 'location_type')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ads' and column_name = 'address')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ads' and column_name = 'lat')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ads' and column_name = 'lng')
    )),
    (8, 'schema-v8-ad-frequency-setting.sql', 'Adjustable ad frequency (Ad Frequency setting)', (select
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_settings' and column_name = 'ad_interval')
    )),
    (9, 'schema-v9-free-feature-comp.sql', 'Free "first-mover" Featured comps', (select
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales' and column_name = 'featured_comp')
    )),
    (10, 'schema-v10-spotted-sales.sql', 'Crowdsourced "spotted a sale" reporting', (select
      exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'spotted_sales')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_settings' and column_name = 'spotted_sale_radius_ft')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_settings' and column_name = 'spotted_sale_confirm_count')
    )),
    (11, 'schema-v11-spotted-sale-details.sql', 'Photos + notes on spotted sales', (select
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'spotted_sales' and column_name = 'photo_urls')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'spotted_sales' and column_name = 'notes')
    )),
    (12, 'schema-v12-ad-ownership.sql', 'Advertiser self-edit accounts (Owner email)', (select
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ads' and column_name = 'owner_email')
    )),
    (13, 'schema-v13-badges.sql', 'Badges, check-ins, and leads (Players)', (select
      exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'players')
      and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'player_activity')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_settings' and column_name = 'checkin_radius_ft')
    )),
    (14, 'schema-v15-ad-link-destination.sql', 'Ad click destination + "Link only" option', (select
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ads' and column_name = 'link_only')
    ))
) as checklist(sort_order, migration_file, feature, is_applied)
order by sort_order;

-- Note: schema-v14-sale-popularity.sql is NOT in this list on purpose --
-- that's the sale-popularity/"trending fire badge" feature, which is
-- still being built and hasn't been delivered to you yet. Nothing to run
-- for it yet.
