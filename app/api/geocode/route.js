import { NextResponse } from 'next/server';
import { extractCity } from '@/lib/nominatimAddress';

// Server-side proxy to OpenStreetMap's free Nominatim geocoder. Runs on the
// server so we can set a proper identifying User-Agent, as Nominatim's usage
// policy requires (https://operations.osmfoundation.org/policies/nominatim/).
// Free, no API key -- matches the free Leaflet/OpenStreetMap map in the app.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address');

  if (!address || !address.trim()) {
    return NextResponse.json({ error: 'Missing "address" query param' }, { status: 400 });
  }

  const nominatimUrl = new URL('https://nominatim.openstreetmap.org/search');
  nominatimUrl.searchParams.set('format', 'json');
  nominatimUrl.searchParams.set('q', address);
  nominatimUrl.searchParams.set('limit', '1');
  nominatimUrl.searchParams.set('addressdetails', '1');

  const res = await fetch(nominatimUrl.toString(), {
    headers: {
      // Replace with your own domain/contact once deployed, per Nominatim's usage policy.
      'User-Agent': 'SaleHop/1.0 (garage sale finder; contact via site owner)',
      'Accept-Language': 'en',
    },
  });

  if (!res.ok) {
    return NextResponse.json({ error: `Nominatim request failed (${res.status})` }, { status: 502 });
  }

  const results = await res.json();
  if (!results || results.length === 0) {
    return NextResponse.json(null);
  }

  return NextResponse.json({
    lat: parseFloat(results[0].lat),
    lng: parseFloat(results[0].lon),
    displayName: results[0].display_name,
    city: extractCity(results[0].address),
  });
}
