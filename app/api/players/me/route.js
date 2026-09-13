import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';
import { getPlayerCounts } from '@/lib/badgeEngine';
import { getEarnedBadgeIds } from '@/lib/badges';

// Powers components/BadgesScreen.js and BadgeUnlockModal.js -- "how am I
// doing" for this one anonymous device. Returns this device's OWN
// email/phone/username back to it (fine: only a browser that already
// knows its own deviceId could ask), never anyone else's -- that's what
// the separate, public-safe /api/leaderboard is for.
export async function GET(request) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Not available right now.' }, { status: 500 });
  }

  const deviceId = new URL(request.url).searchParams.get('deviceId');
  if (!deviceId) {
    return NextResponse.json({ error: 'Missing device id.' }, { status: 400 });
  }

  const [{ data: player }, counts] = await Promise.all([
    supabaseAdmin.from('players').select('username, email, phone, marketing_opt_in').eq('device_id', deviceId).maybeSingle(),
    getPlayerCounts(deviceId),
  ]);

  return NextResponse.json({
    player: player
      ? {
          username: player.username || null,
          email: player.email || null,
          phone: player.phone || null,
          marketingOptIn: Boolean(player.marketing_opt_in),
        }
      : null,
    counts,
    earnedBadgeIds: getEarnedBadgeIds(counts),
  });
}
