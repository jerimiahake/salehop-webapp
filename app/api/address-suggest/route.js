import { NextResponse } from 'next/server';

// Server-side proxy to OpenStreetMap's free Nominatim geocoder, used for
// as-you-type address suggestions on the Post screen. Same host as
// /api/geocode (already proven working in production), just asking for a
// short list of candidate matches instead of a single best match.
//
// Nominatim's usage policy asks apps not to fire a request on every
// keystroke (https://operations.osmfoundation.org/policies/nominatim/), so
// the actual debouncing/min-length gating happens client-side in
// lib/geocode.js -- this route just answers whatever query it's given.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query || !query.trim()) {
    return NextResponse.json([]);
  }

  const nominatimUrl = new URL('https://nominatim.openstreetmap.org/search');
  nominatimUrl.searchParams.set('format', 'json');
  nominatimUrl.searchParams.set('q', query);
  nominatimUrl.searchParams.set('limit', '5');

  const res = await fetch(nominatimUrl.toString(), {
    headers: {
      // Replace with your own domain/contact once deployed, per Nominatim's usage policy.
      'User-Agent': 'SaleHop/1.0 (garage sale finder; contact via site owner)',
      'Accept-Language': 'en',
    },
  });

  if (!res.ok) {
    // Suggestions are a nice-to-have -- fail soft so a hiccup here never
    // blocks someone from typing/submitting their address by hand.
    return NextResponse.json([]);
  }

  const results = await res.json();
  const suggestions = (results || []).map((r) => ({
    label: r.display_name,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  }));

  return NextResponse.json(suggestions);
}
