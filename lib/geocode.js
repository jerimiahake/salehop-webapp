// Turns a street address into { lat, lng } using OpenStreetMap's free
// Nominatim geocoder -- no API key, no billing, matching the map itself
// (Leaflet + OpenStreetMap tiles).
//
// This calls our own /api/geocode route rather than Nominatim directly,
// because Nominatim's usage policy requires an identifying User-Agent
// header, and browsers block client-side JS from setting that header. The
// API route (app/api/geocode/route.js) makes the actual Nominatim request
// server-side, where that header can be set properly.
export async function geocodeAddress(address) {
  if (!address || !address.trim()) return null;

  const res = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
  if (!res.ok) {
    throw new Error(`Geocoding request failed (${res.status})`);
  }
  return res.json();
}

// Fetches up to 5 candidate address matches for as-you-type suggestions on
// the Post screen, via our own /api/address-suggest proxy. Pass an
// AbortSignal so a caller can cancel a stale request if the user keeps
// typing before it resolves.
export async function suggestAddress(query, signal) {
  if (!query || !query.trim()) return [];

  const res = await fetch(`/api/address-suggest?q=${encodeURIComponent(query)}`, { signal });
  if (!res.ok) return [];
  return res.json();
}

// Turns { lat, lng } (from the browser's own Geolocation API) into a street
// address, for the "Use my current location" button on the Post screen.
// Goes through our own /api/reverse-geocode route for the same
// User-Agent-header reason as geocodeAddress above.
export async function reverseGeocode(lat, lng) {
  const res = await fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}`);
  if (!res.ok) {
    throw new Error(`Reverse geocoding request failed (${res.status})`);
  }
  return res.json();
}
