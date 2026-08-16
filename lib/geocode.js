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
