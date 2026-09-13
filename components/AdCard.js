'use client';

import HtmlSnippet from './HtmlSnippet';

// Styled to echo SaleCard's layout (so it fits naturally in the scrolling
// list) but visually distinct: a highlighted gold background/border and an
// "AD" badge. Two flavors:
//   "image"   -- a title/sponsor/image card. By default, tapping it opens
//                the ad's own in-app page (app/ad/[id]/page.js -- image,
//                title, description, a "Visit Website" button for its
//                link, and, for a physical location, its address, "I'm
//                here!" check-in button, and Mayor standing). If the ad
//                has `link_only` set (see supabase/schema-v15-ad-link-
//                destination.sql -- an option on the ad create/edit
//                forms), tapping it skips that page entirely and jumps
//                straight to link_url in a new tab instead, for a sponsor
//                who just wants direct click-through.
//   "snippet" -- a raw HTML/JS embed (e.g. a Google Ads tag) rendered
//                as-is; it manages its own click-through, so the card
//                itself isn't clickable.
// Independent of ad_type/link_only: a "physical location" ad
// (location_type === 'physical', geocoded -- see AdForm.js) shows its
// address instead of a sponsor line, plus the same favorite star and
// route-number badge a SaleCard shows, so a real place (a Goodwill, a
// Habitat ReStore) can be added to a buyer's route the same way a garage
// sale can. An "online only" ad never shows a star -- there's nowhere to
// route to.
export default function AdCard({ ad, favorited, routeNum, onToggleFavorite }) {
  const isPhysical = ad.location_type === 'physical' && Number.isFinite(ad.lat) && Number.isFinite(ad.lng);

  if (ad.ad_type === 'snippet') {
    return (
      <div className="card ad-card ad-card-snippet">
        <span className="ad-badge ad-badge-snippet">AD</span>
        <HtmlSnippet html={ad.html_snippet} />
      </div>
    );
  }

  const cover = ad.image_url || null;

  // link_only + a real link_url is the only case that skips the in-app
  // page -- everything else (the new default, or a link_only ad that
  // somehow has no link_url on file) lands on /ad/[id]. That fallback is
  // what fixes the original dead-click bug: several physical-location ads
  // seeded via seed_physical_ads.sql have no link_url at all, so without
  // it those cards would still do nothing even with link_only left false.
  function handleClick() {
    if (ad.link_only && ad.link_url) {
      window.open(ad.link_url, '_blank', 'noopener,noreferrer');
      return;
    }
    window.open(`/ad/${ad.id}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className={`card ad-card ${favorited ? 'favorited' : ''}`} onClick={handleClick}>
      {favorited && <div className="route-num">{routeNum}</div>}
      <div className="thumb" style={{ background: '#FCE9B8' }}>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" />
        ) : (
          '📣'
        )}
      </div>
      <div className="card-body">
        <p className="card-title">{ad.title}</p>
        {isPhysical ? (
          <p className="ad-sponsor">📍 {ad.address}</p>
        ) : (
          ad.sponsor_name && <p className="ad-sponsor">Sponsored by {ad.sponsor_name}</p>
        )}
        <div className="card-meta">
          <span className="ad-badge">AD</span>
        </div>
      </div>
      {isPhysical && (
        <button
          type="button"
          className={`fav-btn ${favorited ? 'on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite?.(ad.id);
          }}
          aria-label={favorited ? 'Remove from route' : 'Add to route'}
        >
          ★
        </button>
      )}
    </div>
  );
}
