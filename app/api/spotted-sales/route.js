import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';
import { distanceMiles } from '@/lib/format';

// Public, no-account-needed crowdsourced sale-spotting (Bob taps
// "🚩 Spot a Sale" while driving by; Jane gets prompted to confirm one
// once she's physically close). Both GET (the map's pins) and POST
// (reporting a sighting) go through the service-role connection --
// `spotted_sales` has no public RLS policy (see
// supabase/schema-v10-spotted-sales.sql) since the clustering/distance
// math below has to run server-side anyway, and the per-report device
// ids need to stay confidential.

// An unconfirmed report nobody ever finishes confirming quietly stops
// showing up after this many days, so the map doesn't slowly fill with
// stale sightings -- a *confirmed* spot never expires this way (same
// "no automatic listing expiry" behavior as real sales -- an admin can
// always delete one manually from /admin if it goes stale).
const STALE_UNCONFIRMED_DAYS = 3;

async function loadSpotSettings() {
  const { data } = await supabaseAdmin.from('app_settings').select('*').eq('id', 1).single();
  return {
    radiusFt: Number.isFinite(data?.spotted_sale_radius_ft) ? data.spotted_sale_radius_ft : 300,
    confirmCount: Number.isFinite(data?.spotted_sale_confirm_count) ? data.spotted_sale_confirm_count : 3,
  };
}

export async function GET() {
  if (!isSupabaseAdminConfigured) return NextResponse.json([]);

  const staleCutoff = new Date(Date.now() - STALE_UNCONFIRMED_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('spotted_sales')
    .select('id, lat, lng, status')
    .neq('status', 'rejected')
    .or(`status.eq.confirmed,last_reported_at.gte.${staleCutoff}`);

  if (error) return NextResponse.json([]);
  return NextResponse.json(data || []);
}

export async function POST(request) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Reporting is not available right now.' }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.slice(0, 100) : null;

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: 'A real location is needed to report a sale.' }, { status: 400 });
  }
  if (!deviceId) {
    return NextResponse.json({ error: 'Missing device id.' }, { status: 400 });
  }

  const { radiusFt, confirmCount } = await loadSpotSettings();
  const staleCutoff = new Date(Date.now() - STALE_UNCONFIRMED_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Look for a nearby, still-fresh unconfirmed report to merge into,
  // rather than creating a brand-new pin for every single report of the
  // same sale. Small-scale distance check done in JS (same approach as
  // the ad-proximity sort in AppShell.js) rather than a spatial SQL
  // query -- plenty fast at this app's scale.
  const { data: candidates } = await supabaseAdmin
    .from('spotted_sales')
    .select('*')
    .eq('status', 'unconfirmed')
    .gte('last_reported_at', staleCutoff);

  let match = null;
  let matchDistanceFt = Infinity;
  for (const candidate of candidates || []) {
    const distanceFt = (distanceMiles({ lat, lng }, { lat: candidate.lat, lng: candidate.lng }) || Infinity) * 5280;
    if (distanceFt <= radiusFt && distanceFt < matchDistanceFt) {
      match = candidate;
      matchDistanceFt = distanceFt;
    }
  }

  if (match) {
    const alreadyReported = (match.reporter_device_ids || []).includes(deviceId);
    const nextDeviceIds = alreadyReported ? match.reporter_device_ids : [...(match.reporter_device_ids || []), deviceId];
    const justConfirmed = !alreadyReported && nextDeviceIds.length >= confirmCount;

    const updates = {
      reporter_device_ids: nextDeviceIds,
      last_reported_at: new Date().toISOString(),
    };
    if (justConfirmed) {
      updates.status = 'confirmed';
      updates.confirmation_method = 'crowd';
      updates.confirmed_at = new Date().toISOString();
    }

    const { data, error } = await supabaseAdmin
      .from('spotted_sales')
      .update(updates)
      .eq('id', match.id)
      .select('id, lat, lng, status')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ...data, alreadyReported, justConfirmed });
  }

  const { data, error } = await supabaseAdmin
    .from('spotted_sales')
    .insert({ lat, lng, reporter_device_ids: [deviceId] })
    .select('id, lat, lng, status')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...data, alreadyReported: false, justConfirmed: false });
}
