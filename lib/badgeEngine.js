import { supabaseAdmin, isSupabaseAdminConfigured } from './supabaseAdmin';
import { getEarnedBadgeIds, getBadgeById } from './badges';

// Server-only badge bookkeeping -- built on top of the `players` /
// `player_activity` tables from supabase/schema-v13-badges.sql. Every
// route that logs a badge-relevant action (app/api/spotted-sales,
// app/api/spotted-sales/[id]/photos, app/api/checkins) goes through
// recordActivityAndCheckBadges() below rather than writing
// `player_activity` directly, so "did this action just unlock a new
// badge" is computed in exactly one place.
//
// Dates are grouped in UTC throughout (weekend/early-bird detection) --
// deliberately approximate for a fun, low-stakes feature; not worth
// storing/asking for each visitor's real timezone.

function isWeekend(iso) {
  const day = new Date(iso).getUTCDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6;
}

// Groups a Saturday and the Sunday right after it under the same key, so
// "checked in Sat and Sun of the same weekend" counts as one weekend, not
// two, toward Weekend Warrior.
function weekendKey(iso) {
  const d = new Date(iso);
  const backToSaturday = d.getUTCDay() === 0 ? 1 : 0;
  const sat = new Date(d.getTime() - backToSaturday * 86400000);
  return sat.toISOString().slice(0, 10);
}

function isEarlyBird(iso) {
  return new Date(iso).getUTCHours() < 8;
}

const EMPTY_COUNTS = {
  spottedReports: 0,
  spottedConfirmedOwn: 0,
  spottedConfirmingReports: 0,
  photosContributed: 0,
  salesVisited: 0,
  distinctLocationsVisited: 0,
  earlyBirdCheckins: 0,
  distinctCheckinWeekends: 0,
  joinRank: null,
};

// Pure reducer: turns one device's raw player_activity rows (+ its
// already-known join rank, if any) into the flat "counts" shape
// lib/badges.js's check() functions expect. Split out from getPlayerCounts
// below so /api/leaderboard can fetch every relevant player's activity in
// ONE query and reduce each device's rows locally, rather than running
// getPlayerCounts (2+ round trips each) once per player on the
// leaderboard -- see app/api/leaderboard/route.js.
export function countsFromActivityRows(activity, joinRank = null) {
  const rows = activity || [];
  const distinctRefCount = (type) => new Set(rows.filter((r) => r.activity_type === type && r.ref_id).map((r) => r.ref_id)).size;

  const locationKeys = new Set();
  rows.forEach((r) => {
    if (r.activity_type === 'sale_visited' && r.ref_id) locationKeys.add(`sale:${r.ref_id}`);
    // An ad's ref_id is "<adId>:<yyyy-mm-dd>" -- strip the day so repeat
    // visits to the same store still count as just one "place."
    if (r.activity_type === 'ad_visited' && r.ref_id) locationKeys.add(`ad:${r.ref_id.split(':')[0]}`);
  });

  const checkinRows = rows.filter((r) => r.activity_type === 'sale_visited' || r.activity_type === 'ad_visited');
  const weekendKeys = new Set(checkinRows.filter((r) => isWeekend(r.occurred_at)).map((r) => weekendKey(r.occurred_at)));

  return {
    spottedReports: distinctRefCount('spotted_report'),
    spottedConfirmedOwn: distinctRefCount('spotted_confirmed_own'),
    spottedConfirmingReports: distinctRefCount('spotted_confirming_report'),
    photosContributed: rows.filter((r) => r.activity_type === 'photo_contributed').length,
    salesVisited: distinctRefCount('sale_visited'),
    distinctLocationsVisited: locationKeys.size,
    earlyBirdCheckins: checkinRows.filter((r) => isEarlyBird(r.occurred_at)).length,
    distinctCheckinWeekends: weekendKeys.size,
    joinRank,
  };
}

// Aggregates one device's whole activity history into the counts shape.
// Small-scale app -- fetching every row for one device and reducing in JS
// is simpler (and plenty fast) than hand-rolling the equivalent SQL, same
// approach this codebase already takes for e.g. the ad-proximity sort in
// AppShell.js.
export async function getPlayerCounts(deviceId) {
  if (!isSupabaseAdminConfigured || !deviceId) return { ...EMPTY_COUNTS };

  const [{ data: rows }, { data: player }] = await Promise.all([
    supabaseAdmin.from('player_activity').select('activity_type, ref_id, occurred_at').eq('device_id', deviceId),
    supabaseAdmin.from('players').select('created_at').eq('device_id', deviceId).maybeSingle(),
  ]);

  let joinRank = null;
  if (player?.created_at) {
    const { count } = await supabaseAdmin
      .from('players')
      .select('id', { count: 'exact', head: true })
      .lte('created_at', player.created_at);
    joinRank = Number.isFinite(count) ? count : null;
  }

  return countsFromActivityRows(rows, joinRank);
}

// Logs one activity event for a device (creating its `players` row on
// first contact) and reports back any badge that newly became true as a
// result -- so the caller can pop the celebration/email-capture modal
// only on an actual new unlock, never on every single action.
//
// `refId` doubles as the de-dup key: the same (deviceId, activityType,
// refId) triple is only ever recorded once. Callers choose refId's
// granularity on purpose -- a spotted-sale report uses the spot's id
// (report it twice, only counts once), an ad check-in uses "<adId>:
// <day>" (once per place per day, so Mayor standing still rewards
// showing up again on a different day).
export async function recordActivityAndCheckBadges({ deviceId, activityType, refId }) {
  if (!isSupabaseAdminConfigured || !deviceId || !activityType) {
    return { newlyRecorded: false, newBadges: [] };
  }

  await supabaseAdmin.from('players').upsert({ device_id: deviceId }, { onConflict: 'device_id', ignoreDuplicates: true });

  if (refId) {
    const { data: existing } = await supabaseAdmin
      .from('player_activity')
      .select('id')
      .eq('device_id', deviceId)
      .eq('activity_type', activityType)
      .eq('ref_id', refId)
      .maybeSingle();
    if (existing) {
      return { newlyRecorded: false, newBadges: [] };
    }
  }

  const before = getEarnedBadgeIds(await getPlayerCounts(deviceId));

  const { error } = await supabaseAdmin
    .from('player_activity')
    .insert({ device_id: deviceId, activity_type: activityType, ref_id: refId || null });
  if (error) {
    return { newlyRecorded: false, newBadges: [], error: error.message };
  }

  const after = getEarnedBadgeIds(await getPlayerCounts(deviceId));
  const newBadges = after.filter((id) => !before.includes(id)).map(getBadgeById).filter(Boolean);

  return { newlyRecorded: true, newBadges };
}
