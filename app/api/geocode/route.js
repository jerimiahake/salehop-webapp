import { NextResponse } from 'next/server';
import { extractCity, stripUnit } from '@/lib/nominatimAddress';

// Server-side proxy to OpenStreetMap's free Nominatim geocoder. Runs on the
// server so we can set a proper identifying User-Agent, as Nominatim's usage
// policy requires (https://operations.osmfoundation.org/policies/nominatim/).
// Free, no API key -- matches the free Leaflet/OpenStreetMap map in the app.
//
// A single Nominatim lookup misses a surprising number of real addresses --
// its worldwide parser trips on apartment/unit suffixes, and it's simply
// missing some smaller/newer streets from its OpenStreetMap data. Rather
// than fail the whole listing at that point, this tries a few things in
// order before giving up: the address as typed, the same address with any
// unit/suite info stripped off (a unit suffix never helps a building-level
// geocoder match), and finally the US Census Bureau's free geocoder, which
// is purpose-built for US postal addresses and often succeeds where
// Nominatim's general worldwide parser doesn't.

const NOMINATIM_HEADERS = {
  // Replace with your own domain/contact once deployed, per Nominatim's usage policy.
  'User-Agent': 'SaleHop/1.0 (garage sale finder; contact via site owner)',
  'Accept-Language': 'en',
};

async function nominatimSearch(query) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('countrycodes', 'us');

  const res = await fetch(url.toString(), { headers: NOMINATIM_HEADERS });
  if (!res.ok) throw new Error(`Nominatim request failed (${res.status})`);

  const results = await res.json();
  if (!results || results.length === 0) return null;
  const r = results[0];
  return {
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    displayName: r.display_name,
    city: extractCity(r.address),
  };
}

// US Census Bureau geocoder -- free, no API key or signup, no rate-limit
// headers required. US-only and its match string is plainer than
// Nominatim's ("123 MAIN ST, SPRINGFIELD, IL, 62704" vs a nicely-punctuated
// display_name), so it's used as a fallback rather than the primary source.
async function censusSearch(query) {
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
    lat: match.coordinates.y,
    lng: match.coordinates.x,
    displayName: match.matchedAddress,
    city: match.addressComponents?.city || null,
  };
}

async function tryAll(query) {
  try {
    const hit = await nominatimSearch(query);
    if (hit) return hit;
  } catch {
    // fall through to the next source below
  }
  try {
    return await censusSearch(query);
  } catch {
    return null;
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address');

  if (!address || !address.trim()) {
    return NextResponse.json({ error: 'Missing "address" query param' }, { status: 400 });
  }
  const raw = address.trim();

  let match = await tryAll(raw);

  if (!match) {
    const cleaned = stripUnit(raw);
    if (cleaned && cleaned !== raw) {
      match = await tryAll(cleaned);
    }
  }

  return NextResponse.json(match || null);
}
