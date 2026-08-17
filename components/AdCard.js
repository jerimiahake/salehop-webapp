'use client';

import HtmlSnippet from './HtmlSnippet';

// Styled to echo SaleCard's layout (so it fits naturally in the scrolling
// list) but visually distinct: a highlighted gold background/border and an
// "AD" badge, no address (it's not a real sale). Two flavors:
//   "image"   -- a title/sponsor/image card; tapping it opens the
//                sponsor's link in a new tab, same as before.
//   "snippet" -- a raw HTML/JS embed (e.g. a Google Ads tag) rendered
//                as-is; it manages its own click-through, so the card
//                itself isn't clickable.
export default function AdCard({ ad }) {
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
    window.open(ad.link_url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="card ad-card" onClick={handleClick}>
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
        {ad.sponsor_name && <p className="ad-sponsor">Sponsored by {ad.sponsor_name}</p>}
        <div className="card-meta">
          <span className="ad-badge">AD</span>
        </div>
      </div>
    </div>
  );
}
