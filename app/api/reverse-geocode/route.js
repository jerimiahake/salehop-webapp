import { NextResponse } from 'next/server';
import { extractCity } from '@/lib/nominatimAddress';

// Turns { lat, lng } (from the browser's Geolocation API) back into a
// street address, for the "Use my current location" button on the Post
// screen. Server-side proxy to Nominatim's reverse geocoder, same reason
// as /api/geocode -- Nominatim's usage policy requires an identifying
// User-Agent header that browsers block client-side JS from setting.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');

  if (!lat || !lng || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
    return NextResponse.json({ error: 'Missing/invalid "lat"/"lng" query params' }, { status: 400 });
  }

  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'json');
  url.searchParams.set('lat', lat);
  url.searchParams.set('lon', lng);
  url.searchParams.set('addressdetails', '1');
  // Zoom 18 = building-level precision (Nominatim's reverse zoom scale
  // tops out there) -- we want the actual house/building, not a
  // neighborhood or street-level guess.
  url.searchParams.set('zoom', '18');

  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'SaleHop/1.0 (garage sale finder; contact via site owner)',
      'Accept-Language': 'en',
    },
  });

  if (!res.ok) {
    return NextResponse.json({ error: `Nominatim reverse request failed (${res.status})` }, { status: 502 });
  }

  const r = await res.json();
  if (!r || r.error || !r.lat || !r.lon) {
    return NextResponse.json(null);
  }

  return NextResponse.json({
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    displayName: r.display_name,
    city: extractCity(r.address),
  });
}
