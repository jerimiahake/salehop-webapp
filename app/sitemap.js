import { createClient } from '@supabase/supabase-js';
import { SITE_URL } from '@/lib/site';

// Next.js's built-in sitemap convention -- this file is automatically
// served at salehop.app/sitemap.xml with no route needed. Lists every
// real, public URL on the site so search engines can actually find
// individual listing/ad pages, rather than relying on stumbling into them
// on their own -- Browse/Map is a single-page app with no plain <a href>
// links to each listing, so without this a crawler has no map of what
// exists beyond the homepage.
//
// Uses the public anon key (not service-role), the same restricted read
// every anonymous visitor already gets -- only approved sales / active
// ads are ever listed here, matching exactly what's actually reachable
// and meant to be public.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// A soft cap, not a hard platform limit (Google accepts up to 50,000 URLs
// per sitemap file) -- just a sane ceiling so this can't balloon
// unexpectedly before the "no automatic listing expiry" follow-up (see
// build status doc) is ever addressed.
const MAX_URLS_PER_TYPE = 2000;

export default async function sitemap() {
  const staticUrls = [
    { url: SITE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/contact`, changeFrequency: 'monthly', priority: 0.3 },
  ];

  if (!supabaseUrl || !supabaseAnonKey) {
    // No Supabase configured (e.g. a preview build missing env vars) --
    // still return the static pages rather than failing the whole route.
    return staticUrls;
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  });

  const [{ data: sales }, { data: ads }] = await Promise.all([
    client
      .from('sales')
      .select('id, created_at')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(MAX_URLS_PER_TYPE),
    client
      .from('ads')
      .select('id, created_at')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(MAX_URLS_PER_TYPE),
  ]);

  const listingUrls = (sales || []).map((sale) => ({
    url: `${SITE_URL}/listing/${sale.id}`,
    lastModified: sale.created_at ? new Date(sale.created_at) : undefined,
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  const adUrls = (ads || []).map((ad) => ({
    url: `${SITE_URL}/ad/${ad.id}`,
    lastModified: ad.created_at ? new Date(ad.created_at) : undefined,
    changeFrequency: 'weekly',
    priority: 0.5,
  }));

  return [...staticUrls, ...listingUrls, ...adUrls];
}
