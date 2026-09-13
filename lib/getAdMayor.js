import { supabaseAdmin, isSupabaseAdminConfigured } from './supabaseAdmin';

// Foursquare-style "Mayor" for a physical-location ad (a Goodwill, a ReStore,
// a recurring flea market -- see supabase/schema-v12-ad-ownership.sql). A
// garage sale is a one-time event and can't have a Mayor; only ads with
// location_type === 'physical' are ever passed in here (see app/ad/[id]/page.js).
//
// "Most visits" is measured in distinct calendar days checked in, not raw
// check-in rows -- app/api/checkins/route.js already enforces that by giving
// each day's check-in its own ref_id ("<adId>:<yyyy-mm-dd>"), so counting
// distinct ref_ids here is exactly counting distinct days.
//
// Only ever surfaces a device that has voluntarily set a username (same
// privacy rule as /api/leaderboard) -- an anonymous device_id is never shown
// publicly, so if the current leader hasn't claimed a username yet, this
// looks past them to the next device that has, and returns null if none
// have.
export async function getAdMayor(adId) {
  if (!isSupabaseAdminConfigured || !adId) return null;

  const { data: rows } = await supabaseAdmin
    .from('player_activity')
    .select('device_id, ref_id')
    .eq('activity_type', 'ad_visited')
    .like('ref_id', `${adId}:%`);

  if (!rows || rows.length === 0) return null;

  const visitsByDevice = new Map(); // device_id -> Set of distinct day ref_ids
  rows.forEach((row) => {
    if (!visitsByDevice.has(row.device_id)) visitsByDevice.set(row.device_id, new Set());
    visitsByDevice.get(row.device_id).add(row.ref_id);
  });

  const ranked = [...visitsByDevice.entries()]
    .map(([deviceId, days]) => ({ deviceId, visits: days.size }))
    .sort((a, b) => b.visits - a.visits);

  if (ranked.length === 0) return null;

  const deviceIds = ranked.map((r) => r.deviceId);
  const { data: players } = await supabaseAdmin
    .from('players')
    .select('device_id, username')
    .in('device_id', deviceIds)
    .not('username', 'is', null);

  const usernameByDevice = new Map((players || []).map((p) => [p.device_id, p.username]));

  const mayor = ranked.find((r) => usernameByDevice.has(r.deviceId));
  if (!mayor) return null;

  return { username: usernameByDevice.get(mayor.deviceId), visits: mayor.visits };
}
