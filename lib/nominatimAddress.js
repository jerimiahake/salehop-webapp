// Shared by /api/geocode and /api/address-suggest. Nominatim's
// addressdetails=1 option returns a structured breakdown of a match
// instead of just one flat display string -- this picks the most sensible
// "city" label out of that breakdown for a US town/city.
//
// Small towns (like Lapel, IN) are usually classified as "town" rather
// than "city" in OpenStreetMap's data, so the fallback chain matters --
// city-only would miss most small towns entirely.
export function extractCity(addressDetails) {
  if (!addressDetails) return null;
  return (
    addressDetails.city ||
    addressDetails.town ||
    addressDetails.village ||
    addressDetails.hamlet ||
    addressDetails.county ||
    null
  );
}

// Strips apartment/unit/suite/floor info off the end of an address (e.g.
// "123 Main St Apt 4B" -> "123 Main St", "500 Oak Ave, Unit 12" -> "500 Oak
// Ave"). Both Nominatim and the Census geocoder index buildings, not
// individual units, so a unit suffix never actually helps them match --
// it just adds tokens their parser can trip over. Stripping it before a
// retry turns a real chunk of "address not found" misses into hits.
const UNIT_PATTERN =
  /,?\s*(?:\b(?:apt|apartment|unit|suite|ste|bldg|building|fl|floor|rm|room)\b\.?\s*[a-z0-9-]*|#\s*[a-z0-9-]+)(?=\s*(?:,|$))/gi;

export function stripUnit(address) {
  if (!address) return address;
  const stripped = address.replace(UNIT_PATTERN, '');
  return stripped.replace(/\s{2,}/g, ' ').replace(/,\s*,/g, ',').replace(/,\s*$/, '').trim();
}
