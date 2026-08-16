import { upcomingDateFor } from './format';

// Sample sales shown when Supabase isn't configured yet, so the app is
// browsable immediately during development/preview. Coordinates are a
// fictional cluster (adjust to your own town's center once you're live --
// real sales will be geocoded automatically from their address on submit).
// Dates are computed relative to "today" (upcoming Fri/Sat/Sun) rather than
// hardcoded, so the sample data always shows up under the day pills no
// matter when someone previews the app.
const CENTER = { lat: 43.6591, lng: -70.2568 };

function jitter(seed) {
  // deterministic small offset so sample pins spread out around CENTER
  const a = Math.sin(seed * 12.9898) * 43758.5453;
  return (a - Math.floor(a) - 0.5) * 0.02;
}

const FRI = upcomingDateFor('FRI');
const SAT = upcomingDateFor('SAT');
const SUN = upcomingDateFor('SUN');

export const sampleSales = [
  { id: 's1', title: 'Whitfield Family Multi-Home Sale', address: '214 Larkspur Ln', time: '7:00 AM–1:00 PM', tags: ['Furniture', 'Multi-Family'], icon: '🛋️', lat: CENTER.lat + jitter(1), lng: CENTER.lng + jitter(11), status: 'approved', sale_date: SAT },
  { id: 's2', title: 'Downsizing — Everything Must Go', address: '88 Cobblestone Ct', time: '8:00 AM–2:00 PM', tags: ['Vintage', 'Decor'], icon: '🏺', lat: CENTER.lat + jitter(2), lng: CENTER.lng + jitter(12), status: 'approved', sale_date: SAT },
  { id: 's3', title: 'Kids Clothes & Toy Blowout', address: '1140 Maple Ridge Dr', time: '9:00 AM–12:00 PM', tags: ['Kids'], icon: '🧸', lat: CENTER.lat + jitter(3), lng: CENTER.lng + jitter(13), status: 'approved', sale_date: SAT },
  { id: 's4', title: 'Garage Full of Tools', address: '56 Foundry St', time: '7:00 AM–11:00 AM', tags: ['Tools'], icon: '🔧', lat: CENTER.lat + jitter(4), lng: CENTER.lng + jitter(14), status: 'approved', sale_date: FRI },
  { id: 's5', title: 'Estate Sale — Antiques', address: '902 Birchwood Ave', time: '8:00 AM–3:00 PM', tags: ['Vintage', 'Furniture'], icon: '🪑', lat: CENTER.lat + jitter(5), lng: CENTER.lng + jitter(15), status: 'approved', sale_date: SAT },
  { id: 's6', title: 'Neighborhood Yard Sale (5 homes)', address: 'Elm St & 3rd Ave', time: '8:00 AM–1:00 PM', tags: ['Multi-Family'], icon: '🏘️', lat: CENTER.lat + jitter(6), lng: CENTER.lng + jitter(16), status: 'approved', sale_date: SUN },
  { id: 's7', title: 'Baby Gear & Books', address: '33 Hollow Creek Rd', time: '9:00 AM–1:00 PM', tags: ['Kids', 'Books'], icon: '📚', lat: CENTER.lat + jitter(7), lng: CENTER.lng + jitter(17), status: 'approved', sale_date: SUN },
];

export const MAP_CENTER = CENTER;
