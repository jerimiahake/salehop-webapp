import { NextResponse } from 'next/server';
import { extractCity } from '@/lib/nominatimAddress';

// Server-side proxy to OpenStreetMap's free Nominatim geocoder, used for
// as-you-type address suggestions on the Post screen. Same host as
// /api/geocode (already proven working in production), just asking for a
// short list of candidate matches instead of a single best match.
//
// Nominatim's usage policy asks apps not to fire a request on every
// keystroke (https://operations.osmfoundation.org/policies/nominatim/), so
// the actual debouncing/min-length gating happens client-side in
// lib/geocode.js -- this route just answers whatever query it's given.
//
// If Nominatim comes back empty (it misses a fair number of real US
// addresses), this falls back to the US Census Bureau's free geocoder --
// purpose-built for US postal addresses -- so the person still sees one
// suggestion to click instead of a suggestion list that just goes quiet.

const NOMINATIM_HEADERS = {
  // Replace with your own domain/contact once deployed, per Nominatim's usage policy.
  'User-Agent': 'SaleHop/1.0 (garage sale finder; contact via site owner)',
  'Accept-Language': 'en',
};

async function nominatimSuggestions(query) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '5');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('countrycodes', 'us');

  const res = await fetch(url.toString(), { headers: NOMINATIM_HEADERS });
  if (!res.ok) return [];

  const results = await res.json();
  return (results || []).map((r) => ({
    label: r.display_name,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    city: extractCity(r.address),
  }));
}

async function censusSuggestion(query) {
  const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
  url.searchParams.set('address', query);
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString());
  if (!res.ok) return null;

  const data = await res.json();
  const match = data?.result?.addressMatches?.[0];
  if (!match) return null;
  return {
    label: match.matchedAddress,
    lat: match.coordinates.y,
    lng: match.coordinates.x,
    city: match.addressComponents?.city || null,
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query || !query.trim()) {
    return NextResponse.json([]);
  }
  const trimmed = query.trim();

  let suggestions = [];
  try {
    suggestions = await nominatimSuggestions(trimmed);
  } catch {
    // Suggestions are a nice-to-have -- fail soft so a hiccup here never
    // blocks someone from typing/submitting their address by hand.
    suggestions = [];
  }

  if (suggestions.length === 0) {
    try {
      const fallback = await censusSuggestion(trimmed);
      if (fallback) suggestions = [fallback];
    } catch {
      // still nothing -- the person can keep typing and submit will retry
    }
  }

  return NextResponse.json(suggestions);
}
