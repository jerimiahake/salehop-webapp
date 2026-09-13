import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';
import { distanceMiles, toDateKey } from '@/lib/format';
import { recordActivityAndCheckBadges } from '@/lib/badgeEngine';

// "📍 I'm here!" -- lets a visitor prove they actually showed up to a sale
// or a physical-location ad (a Goodwill, a flea market, ...), powering the
// Explorer badges (lib/badges.js) and, for ads specifically, "Mayor"
// standing (lib/getAdMayor.js) -- same geofenced-proof shape as the
// crowdsourced spotted-sale confirm flow, just against a real listing's
// already-known location instead of a reported one.
//
// A garage sale is a one-time event, so its check-in only ever counts
// once (ref_id is just the sale's id). A physical-location ad is a real,
// re-visitable place, so its check-in counts once per calendar day
// (ref_id embeds today's date) -- that's what lets someone rack up
// multiple visits over time toward Mayor standing without being able to
// just tap the button 50 times in a row for the same effect.
export async function POST(request) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Not available right now.' }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.slice(0, 100) : null;
  const targetType = body?.targetType === 'ad' ? 'ad' : body?.targetType === 'sale' ? 'sale' : null;
  const targetId = typeof body?.targetId === 'string' ? body.targetId : null;
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);

  if (!deviceId) return NextResponse.json({ error: 'Missing device id.' }, { status: 400 });
  if (!targetType || !targetId) return NextResponse.json({ error: 'Missing what to check in to.' }, { status: 400 });
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'A real location is needed to check in.' }, { status: 400 });
  }

  let target = null;
  if (targetType === 'sale') {
    const { data } = await supabaseAdmin
      .from('sales')
      .select('id, lat, lng, status')
      .eq('id', targetId)
      .eq('status', 'approved')
      .maybeSingle();
    target = data;
  } else {
    const { data } = await supabaseAdmin
      .from('ads')
      .select('id, lat, lng, active, location_type')
      .eq('id', targetId)
      .eq('active', true)
      .eq('location_type', 'physical')
      .maybeSingle();
    target = data;
  }

  if (!target || !Number.isFinite(target.lat) || !Number.isFinite(target.lng)) {
    return NextResponse.json({ error: "That listing couldn't be found or doesn't have a located address." }, { status: 404 });
  }

  const { data: settingsRow } = await supabaseAdmin.from('app_settings').select('checkin_radius_ft').eq('id', 1).single();
  const radiusFt = Number.isFinite(settingsRow?.checkin_radius_ft) ? settingsRow.checkin_radius_ft : 300;

  const distanceFt = (distanceMiles({ lat, lng }, { lat: target.lat, lng: target.lng }) ?? Infinity) * 5280;
  if (distanceFt > radiusFt) {
    return NextResponse.json(
      { error: "You don't look close enough yet -- get a little closer and try again." },
      { status: 400 }
    );
  }

  const refId = targetType === 'sale' ? targetId : `${targetId}:${toDateKey(new Date())}`;
  const activityType = targetType === 'sale' ? 'sale_visited' : 'ad_visited';

  const result = await recordActivityAndCheckBadges({ deviceId, activityType, refId });

  return NextResponse.json({
    ok: true,
    alreadyCheckedIn: !result.newlyRecorded,
    newBadges: result.newBadges,
  });
}
