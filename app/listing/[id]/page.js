import { getSaleForShare } from '@/lib/getSaleForShare';
import { formatTimeRange, formatDateRange } from '@/lib/format';
import { SITE_URL } from '@/lib/site';
import ShareToFacebookButton from '@/components/ShareToFacebookButton';

// A real, public, individually-shareable page for one approved sale --
// this is what makes the "Share to Facebook" button actually work: Facebook
// needs a real URL it can fetch and read Open Graph tags from to build a
// nice preview (photo, title, description) in the shared post.
//
// Only approved sales are reachable here (see getSaleForShare, which reads
// through the same anon key + RLS every other visitor uses) -- a listing
// still awaiting review isn't public yet, so there's nothing to share.
export async function generateMetadata({ params }) {
  const sale = await getSaleForShare(params.id);

  if (!sale) {
    return { title: 'Listing not found — SaleHop' };
  }

  const summary = `${formatDateRange(sale.sale_date, sale.end_date)} · ${formatTimeRange(sale.start_time, sale.end_time)} · ${sale.address}`;
  const description = sale.description ? sale.description.slice(0, 160) : summary;
  const image = sale.photo_urls && sale.photo_urls.length > 0 ? sale.photo_urls[0] : null;

  return {
    title: `${sale.title} — SaleHop`,
    description,
    openGraph: {
      title: sale.title,
      description,
      url: `${SITE_URL}/listing/${sale.id}`,
      siteName: 'SaleHop',
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: sale.title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function ListingPage({ params }) {
  const sale = await getSaleForShare(params.id);

  if (!sale) {
    return (
      <div className="share-page">
        <div className="share-card">
          <div className="share-logo marker-font">
            Sale<span>Hop</span>
          </div>
          <div className="share-empty">
            <div className="big">🔍</div>
            <p>This listing isn&apos;t available. It may have been removed, sold out, or isn&apos;t approved yet.</p>
            <a className="publish-btn share-home-btn" href="/">
              Browse Sales on SaleHop →
            </a>
          </div>
        </div>
      </div>
    );
  }

  const cover = sale.photo_urls && sale.photo_urls.length > 0 ? sale.photo_urls[0] : null;
  const listingUrl = `${SITE_URL}/listing/${sale.id}`;

  return (
    <div className="share-page">
      <div className="share-card">
        <div className="share-logo marker-font">
          Sale<span>Hop</span>
        </div>

        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="share-cover" />
        )}

        <div className="share-body">
          {sale.is_neighborhood_sale && sale.neighborhood_name && (
            <div className="neighborhood-badge" style={{ marginBottom: 10 }}>
              🏘️ Part of {sale.neighborhood_name}
            </div>
          )}

          <h1 className="share-title">{sale.title}</h1>
          <p className="share-addr">📍 {sale.address}</p>
          <p className="share-meta">
            <span className="time-badge mono">
              {formatDateRange(sale.sale_date, sale.end_date)} · {formatTimeRange(sale.start_time, sale.end_time)}
            </span>
          </p>

          {sale.tags && sale.tags.length > 0 && (
            <div className="card-meta" style={{ marginTop: 10 }}>
              {sale.tags.map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
              ))}
            </div>
          )}

          {sale.description && <p className="share-desc">{sale.description}</p>}

          <div className="share-actions">
            <ShareToFacebookButton url={listingUrl} quote={sale.title} />
            <a className="chip share-home-link" href="/">
              Browse More Sales on SaleHop →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}