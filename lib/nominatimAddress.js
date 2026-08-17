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
