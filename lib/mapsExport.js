// Builds "open my route" deep links for Google Maps and Apple Maps from an
// ordered list of stops. Both are plain URLs -- no API key, no billing, and
// they open the native app on a phone (falling back to the map provider's
// website if the app isn't installed).
//
// Google Maps caps the free `dir` URL at 9 waypoints + 1 destination (10
// stops total). Apple Maps has no documented hard cap for the `+to:` chain,
// but we apply the same cap for consistency and because a real route with
// more than 10 garage sales is not a realistic single trip.
const MAX_STOPS = 10;

function coordString(stop) {
  return `${stop.lat},${stop.lng}`;
}

/**
 * @param {Array<{lat:number,lng:number}>} stops - ordered route stops
 * @returns {{ url: string|null, truncated: boolean }}
 */
export function buildGoogleMapsUrl(stops) {
  const valid = (stops || []).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  if (valid.length === 0) return { url: null, truncated: false };

  const truncated = valid.length > MAX_STOPS;
  const capped = valid.slice(0, MAX_STOPS);
  const destination = capped[capped.length - 1];
  const waypoints = capped.slice(0, -1);

  const params = new URLSearchParams({
    api: '1',
    destination: coordString(destination),
    travelmode: 'driving',
  });
  if (waypoints.length > 0) {
    params.set('waypoints', waypoints.map(coordString).join('|'));
  }

  return { url: `https://www.google.com/maps/dir/?${params.toString()}`, truncated };
}

/**
 * @param {Array<{lat:number,lng:number}>} stops - ordered route stops
 * @returns {{ url: string|null, truncated: boolean }}
 */
export function buildAppleMapsUrl(stops) {
  const valid = (stops || []).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  if (valid.length === 0) return { url: null, truncated: false };

  const truncated = valid.length > MAX_STOPS;
  const capped = valid.slice(0, MAX_STOPS);
  const chain = capped.map(coordString).join('+to:');

  return {
    url: `https://maps.apple.com/?daddr=${encodeURIComponent(chain)}&dirflg=d`,
    truncated,
  };
}

export const MAPS_EXPORT_MAX_STOPS = MAX_STOPS;
