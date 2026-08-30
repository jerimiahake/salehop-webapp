'use client';

import HtmlSnippet from './HtmlSnippet';

// Styled to echo SaleCard's layout (so it fits naturally in the scrolling
// list) but visually distinct: a highlighted gold background/border and an
// "AD" badge. Two flavors:
//   "image"   -- a title/sponsor/image card; tapping it opens the
//                sponsor's link in a new tab, same as before.
//   "snippet" -- a raw HTML/JS embed (e.g. a Google Ads tag) rendered
//                as-is; it manages its own click-through, so the card
//                itself isn't clickable.
// Independent of that: a "physical location" ad (location_type ===
// 'physical', geocoded -- see AdForm.js) shows its address instead of a
// sponsor line, plus the same favorite star and route-number badge a
// SaleCard shows, so a real place (a Goodwill, a Habitat ReStore) can be
// added to a buyer's route the same way a garage sale can. An "online
// only" ad never shows a star -- there's nowhere to route to.
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

  function handleClick() {
    if (ad.link_url) {
      window.open(ad.link_url, '_blank', 'noopener,noreferrer');
    }
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
