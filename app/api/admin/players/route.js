import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';
import { countsFromActivityRows } from '@/lib/badgeEngine';
import { getEarnedBadgeIds } from '@/lib/badges';

// The actual business payoff of the whole badge system: every email/phone
// a visitor has handed over while earning badges (see BadgeUnlockModal.js),
// in one admin-only list. Unlike /api/leaderboard (public, username-only,
// never exposes contact info), this is the private lead-capture view --
// gated the same way every other /api/admin/** route is.
export async function GET(request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  const { data: players, error } = await supabaseAdmin
    .from('players')
    .select('device_id, username, email, phone, marketing_opt_in, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    // 42P01 = undefined table -- schema-v13-badges.sql hasn't been run yet.
    // Degrade to an empty list with a flag the admin page can show a hint
    // for, same graceful-degradation pattern used for other not-yet-run
    // migrations in this app.
    if (error.code === '42P01') {
      return NextResponse.json({ players: [], migrationNeeded: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const deviceIds = (players || []).map((p) => p.device_id);
  let activityByDevice = new Map(deviceIds.map((id) => [id, []]));
  if (deviceIds.length > 0) {
    const { data: allActivity } = await supabaseAdmin
      .from('player_activity')
      .select('device_id, activity_type, ref_id, occurred_at')
      .in('device_id', deviceIds);
    (allActivity || []).forEach((row) => {
      activityByDevice.get(row.device_id)?.push(row);
    });
  }

  const rows = (players || []).map((p) => {
    const counts = countsFromActivityRows(activityByDevice.get(p.device_id));
    return {
      username: p.username,
      email: p.email,
      phone: p.phone,
      marketingOptIn: Boolean(p.marketing_opt_in),
      createdAt: p.created_at,
      badgeCount: getEarnedBadgeIds(counts).length,
    };
  });

  return NextResponse.json({ players: rows, migrationNeeded: false });
}
