// The full badge catalog -- shared between server code (deciding which
// badges just got newly earned, see lib/badgeEngine.js) and client code
// (rendering the grid in components/BadgesScreen.js). Pure data + pure
// functions only, so it's safe to import from either side.
//
// Every badge's `check(ctx)` runs against one flat "context" object built
// from two different sources merged together:
//   - Scout/Explorer/Community badges come from `player_activity` counts,
//     keyed by the anonymous per-browser deviceId (see lib/deviceId.js) --
//     fetched from GET /api/players/me and spread into ctx as-is.
//   - Seller badges are computed live from the signed-in seller's own
//     `listings` (already loaded by AppShell.js for "My Listings") rather
//     than a separate activity log -- a seller's real listing count is
//     always accurate and they already have a real account/email, so
//     there's no separate lead-capture reason to track it a second way.
//     See components/BadgesScreen.js for where salesPostedCount/
//     hasNeighborhoodSale get computed and merged in.
//
// A badge whose fields aren't present in ctx (e.g. a seller badge when
// nobody's signed in) just evaluates to false rather than throwing --
// every check() below uses `|| 0` / `Boolean(...)` defensively.

export const BADGE_CATEGORIES = {
  scout: { label: 'Scout', blurb: 'Spotting sales while out and about' },
  explorer: { label: 'Explorer', blurb: 'Actually showing up' },
  seller: { label: 'Seller', blurb: 'Posting your own sales' },
  community: { label: 'Community', blurb: 'Helping other SaleHoppers' },
};

export const BADGES = [
  // ---------- Scout (crowdsourced "spotted a sale" reporting) ----------
  {
    id: 'first_sighting',
    category: 'scout',
    emoji: '🔍',
    name: 'First Sighting',
    description: 'Reported your first spotted sale.',
    check: (ctx) => (ctx.spottedReports || 0) >= 1,
  },
  {
    id: 'scout',
    category: 'scout',
    emoji: '🕵️',
    name: 'Scout',
    description: 'Reported 5 spotted sales.',
    check: (ctx) => (ctx.spottedReports || 0) >= 5,
  },
  {
    id: 'eagle_eye',
    category: 'scout',
    emoji: '🦅',
    name: 'Eagle Eye',
    description: 'Reported 25 spotted sales.',
    check: (ctx) => (ctx.spottedReports || 0) >= 25,
  },
  {
    id: 'trusted_scout',
    category: 'scout',
    emoji: '✅',
    name: 'Trusted Scout',
    description: '3 of your sightings went on to get crowd-confirmed.',
    check: (ctx) => (ctx.spottedConfirmedOwn || 0) >= 3,
  },
  {
    id: 'shutterbug',
    category: 'scout',
    emoji: '📸',
    name: 'Shutterbug',
    description: 'Added 5 photos or notes to spotted sales.',
    check: (ctx) => (ctx.photosContributed || 0) >= 5,
  },

  // ---------- Explorer (checking in at sales/ads in person) ----------
  {
    id: 'first_stop',
    category: 'explorer',
    emoji: '🚗',
    name: 'First Stop',
    description: 'Checked in at your first sale.',
    check: (ctx) => (ctx.salesVisited || 0) >= 1,
  },
  {
    id: 'road_warrior',
    category: 'explorer',
    emoji: '🛣️',
    name: 'Road Warrior',
    description: 'Checked in at 10 sales.',
    check: (ctx) => (ctx.salesVisited || 0) >= 10,
  },
  {
    id: 'early_bird',
    category: 'explorer',
    emoji: '🌅',
    name: 'Early Bird',
    description: 'Checked in before 8:00 AM.',
    check: (ctx) => (ctx.earlyBirdCheckins || 0) >= 1,
  },
  {
    id: 'weekend_warrior',
    category: 'explorer',
    emoji: '📅',
    name: 'Weekend Warrior',
    description: 'Checked in on 4 different weekends.',
    check: (ctx) => (ctx.distinctCheckinWeekends || 0) >= 4,
  },
  {
    id: 'well_traveled',
    category: 'explorer',
    emoji: '🗺️',
    name: 'Well-Traveled',
    description: 'Checked in at 5 different places.',
    check: (ctx) => (ctx.distinctLocationsVisited || 0) >= 5,
  },

  // ---------- Seller (posting your own sales) ----------
  {
    id: 'first_sale',
    category: 'seller',
    emoji: '🏷️',
    name: 'First Sale Posted',
    description: 'Posted your first sale on SaleHop.',
    check: (ctx) => (ctx.salesPostedCount || 0) >= 1,
  },
  {
    id: 'serial_seller',
    category: 'seller',
    emoji: '🔁',
    name: 'Serial Seller',
    description: 'Posted 5 sales on SaleHop.',
    check: (ctx) => (ctx.salesPostedCount || 0) >= 5,
  },
  {
    id: 'neighborhood_organizer',
    category: 'seller',
    emoji: '🏘️',
    name: 'Neighborhood Organizer',
    description: 'Posted a neighborhood sale.',
    check: (ctx) => Boolean(ctx.hasNeighborhoodSale),
  },

  // ---------- Community (helping other SaleHoppers) ----------
  {
    id: 'good_neighbor',
    category: 'community',
    emoji: '🤝',
    name: 'Good Neighbor',
    description: "Helped confirm a sale someone else spotted first.",
    check: (ctx) => (ctx.spottedConfirmingReports || 0) >= 1,
  },
  {
    id: 'founding_hopper',
    category: 'community',
    emoji: '🌱',
    name: 'Founding Hopper',
    description: 'One of the first 100 people on SaleHop.',
    check: (ctx) => Number.isInteger(ctx.joinRank) && ctx.joinRank <= 100,
  },
];

export function getEarnedBadgeIds(ctx) {
  return BADGES.filter((b) => {
    try {
      return b.check(ctx || {});
    } catch {
      return false;
    }
  }).map((b) => b.id);
}

export function getBadgeById(id) {
  return BADGES.find((b) => b.id === id) || null;
}
