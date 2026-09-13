import { SITE_URL } from '@/lib/site';

// Next.js's built-in robots convention -- this file is automatically
// served at salehop.app/robots.txt with no route needed. Points crawlers
// at the new sitemap.xml (see app/sitemap.js) and keeps them out of the
// password-gated admin dashboard, internal API routes, and the auth
// redirect callback -- none of those are meant to show up in search
// results, and there's nothing there worth spending crawl budget on.
export default function robots() {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/admin/', '/api/', '/auth/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
