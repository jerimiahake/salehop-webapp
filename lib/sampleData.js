import { nextNDays } from './format';

// Sample sales shown when Supabase isn't configured yet, so the app is
// browsable immediately during development/preview. Coordinates are a
// fictional cluster (adjust to your own town's center once you're live --
// real sales will be geocoded automatically from their address on submit).
// Dates are spread across the next 7 days (today included) so the sample
// data always shows up under the day pills no matter when someone previews
// the app -- not just on the upcoming Fri/Sat/Sun.
const CENTER = { lat: 43.6591, lng: -70.2568 };

function jitter(seed) {
  // deterministic small offset so sample pins spread out around CENTER
  const a = Math.sin(seed * 12.9898) * 43758.5453;
  return (a - Math.floor(a) - 0.5) * 0.02;
}

const NEXT_7 = nextNDays(7).map((d) => d.date);
const DAY0 = NEXT_7[0];
const DAY1 = NEXT_7[1];
const DAY2 = NEXT_7[2];
const DAY5 = NEXT_7[5];
const DAY6 = NEXT_7[6];

export const sampleSales = [
  { id: 's1', title: 'Whitfield Family Multi-Home Sale', address: '214 Larkspur Ln', time: '7:00 AMâ€“1:00 PM', tags: ['Furniture', 'Multi-Family'], icon: 'ðŸ›‹ï¸', lat: CENTER.lat + jitter(1), lng: CENTER.lng + jitter(11), status: 'approved', sale_date: DAY0 },
  { id: 's2', title: 'Downsizing â€” Everything Must Go', address: '88 Cobblestone Ct', time: '8:00 AMâ€“2:00 PM', tags: ['Vintage', 'Decor'], icon: 'ðŸº', lat: CENTER.lat + jitter(2), lng: CENTER.lng + jitter(12), status: 'approved', sale_date: DAY0 },
  { id: 's3', title: 'Kids Clothes & Toy Blowout', address: '1140 Maple Ridge Dr', time: '9:00 AMâ€“12:00 PM', tags: ['Kids'], icon: 'ðŸ§¸', lat: CENTER.lat + jitter(3), lng: CENTER.lng + jitter(13), status: 'approved', sale_date: DAY1 },
  { id: 's4', title: 'Garage Full of Tools', address: '56 Foundry St', time: '7:00 AMâ€“11:00 AM', tags: ['Tools'], icon: 'ðŸ”§', lat: CENTER.lat + jitter(4), lng: CENTER.lng + jitter(14), status: 'approved', sale_date: DAY2 },
  { id: 's5', title: 'Estate Sale â€” Antiques', address: '902 Birchwood Ave', time: '8:00 AMâ€“3:00 PM', tags: ['Vintage', 'Furniture'], icon: 'ðŸª‘', lat: CENTER.lat + jitter(5), lng: CENTER.lng + jitter(15), status: 'approved', sale_date: DAY5 },
  { id: 's6', title: 'Neighborhood Yard Sale (5 homes)', address: 'Elm St & 3rd Ave', time: '8:00 AMâ€“1:00 PM', tags: ['Multi-Family'], icon: 'ðŸ˜ï¸', lat: CENTER.lat + jitter(6), lng: CENTER.lng + jitter(16), status: 'approved', sale_date: DAY6 },
  { id: 's7', title: 'Baby Gear & Books', address: '33 Hollow Creek Rd', time: '9:00 AMâ€“1:00 PM', tags: ['Kids', 'Books'], icon: 'ðŸ“š', lat: CENTER.lat + jitter(7), lng: CENTER.lng + jitter(17), status: 'approved', sale_date: DAY6 },
];

export const MAP_CENTER = CENTER;
