import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';
import { countsFromActivityRows } from '@/lib/badgeEngine';
import { getEarnedBadgeIds, getBadgeById } from '@/lib/badges';

// Public leaderboard, Foursquare-style -- only players who've set a
// username appear (that's the incentive to set one: it's what a badge
// unlock offers, see BadgeUnlockModal.js). Only ever exposes a username,
// a badge count, and the single "best" badge earned -- never email,
// phone, or device_id.
export async function GET() {
  if (!isSupabaseAdminConfigured) return NextResponse.json([]);

  const { data: players } = await supabaseAdmin
    .from('players')
    .select('device_id, username, created_at')
    .not('username', 'is', null);

  if (!players || players.length === 0) return NextResponse.json([]);

  const deviceIds = players.map((p) => p.device_id);
  const { data: allActivity } = await supabaseAdmin
    .from('player_activity')
    .select('device_id, activity_type, ref_id, occurred_at')
    .in('device_id', deviceIds);

  const activityByDevice = new Map(deviceIds.map((id) => [id, []]));
  (allActivity || []).forEach((row) => {
    activityByDevice.get(row.device_id)?.push(row);
  });

  // Join rank among these named players -- an approximation of the real,
  // whole-players-table rank each player's own /api/players/me computes
  // for their Founding Hopper status; fine here since this is only used
  // to rank the leaderboard, not to decide who gets that badge.
  const byJoinDate = [...players].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const joinRankByDevice = new Map(byJoinDate.map((p, i) => [p.device_id, i + 1]));

  const rows = players.map((p) => {
    const counts = countsFromActivityRows(activityByDevice.get(p.device_id), joinRankByDevice.get(p.device_id));
    const badgeIds = getEarnedBadgeIds(counts);
    // "Best" badge = whichever appears latest in the catalog for its
    // category tier (the catalog lists each category easiest-to-hardest),
    // just for a fun single emoji next to the name -- not load-bearing.
    const topBadge = badgeIds.length ? getBadgeById(badgeIds[badgeIds.length - 1]) : null;
    return {
      username: p.username,
      badgeCount: badgeIds.length,
      topBadgeEmoji: topBadge?.emoji || null,
      topBadgeName: topBadge?.name || null,
    };
  });

  rows.sort((a, b) => b.badgeCount - a.badgeCount);

  return NextResponse.json(rows.slice(0, 50));
}
