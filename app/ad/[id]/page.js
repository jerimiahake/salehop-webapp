import { getAdForShare } from '@/lib/getAdForShare';
import { getAdMayor } from '@/lib/getAdMayor';
import { SITE_URL } from '@/lib/site';
import ShareToFacebookButton from '@/components/ShareToFacebookButton';
import HtmlSnippet from '@/components/HtmlSnippet';
import AdCheckIn from '@/components/AdCheckIn';

// A real, public, individually-shareable page for one active ad -- the ad
// equivalent of /listing/[id]. This is what an advertiser can share as
// "their page" on SaleHop, and what makes a Facebook share of it work (a
// real URL Facebook can fetch and read Open Graph tags from).
//
// Only active ads are reachable here (see getAdForShare, which reads
// through the same anon key + RLS every other visitor uses) -- an ad that's
// been paused isn't public yet, so there's nothing to share.
export async function generateMetadata({ params }) {
  const ad = await getAdForShare(params.id);

  if (!ad) {
    return { title: 'Ad not found — SaleHop' };
  }

  const description = ad.description
    ? ad.description.slice(0, 160)
    : ad.location_type === 'physical'
    ? ad.address
    : ad.sponsor_name
    ? `Sponsored by ${ad.sponsor_name}`
    : ad.title;
  const image = ad.image_url || null;

  return {
    title: `${ad.title} — SaleHop`,
    description,
    openGraph: {
      title: ad.title,
      description,
      url: `${SITE_URL}/ad/${ad.id}`,
      siteName: 'SaleHop',
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: ad.title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function AdPage({ params }) {
  const ad = await getAdForShare(params.id);

  if (!ad) {
    return (
      <div className="share-page">
        <div className="share-card">
          <div className="share-logo marker-font">
            Sale<span>Hop</span>
          </div>
          <div className="share-empty">
            <div className="big">🔍</div>
            <p>This ad isn&apos;t available. It may have been removed or paused.</p>
            <a className="publish-btn share-home-btn" href="/">
              Browse Sales on SaleHop →
            </a>
          </div>
        </div>
      </div>
    );
  }

  const adUrl = `${SITE_URL}/ad/${ad.id}`;
  const isPhysical = ad.location_type === 'physical';
  const mayor = isPhysical ? await getAdMayor(ad.id) : null;

  return (
    <div className="share-page">
      <div className="share-card">
        <div className="share-logo marker-font">
          Sale<span>Hop</span>
        </div>

        {ad.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ad.image_url} alt="" className="share-cover" />
        )}

        <div className="share-body">
          <div className="card-meta" style={{ marginBottom: 4 }}>
            <span className="ad-badge">AD</span>
          </div>

          <h1 className="share-title">{ad.title}</h1>

          {ad.location_type === 'physical' && ad.address && <p className="share-addr">📍 {ad.address}</p>}
          {ad.location_type !== 'physical' && ad.sponsor_name && (
            <p className="share-addr">Sponsored by {ad.sponsor_name}</p>
          )}

          {ad.description && <p className="share-desc">{ad.description}</p>}

          {isPhysical && <AdCheckIn adId={ad.id} mayor={mayor} />}

          {ad.ad_type === 'snippet' && (
            <div style={{ marginTop: 12 }}>
              <HtmlSnippet html={ad.html_snippet} />
            </div>
          )}

          <div className="share-actions">
            {ad.ad_type === 'image' && ad.link_url && (
              <a
                className="publish-btn share-home-btn"
                href={ad.link_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', width: 'auto' }}
              >
                Visit Website →
              </a>
            )}
            <ShareToFacebookButton url={adUrl} quote={ad.title} />
            <a className="chip share-home-link" href="/">
              Browse Sales on SaleHop →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
