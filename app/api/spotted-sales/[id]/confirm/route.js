import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';
import { distanceMiles } from '@/lib/format';

// Public "I'm here, confirm it" endpoint -- reached after AppShell.js's
// own proximity check already decided a visitor is close enough to be
// prompted, but this re-checks distance server-side too, so a hand-crafted
// request (or a stale prompt from someone who already drove away) can't
// confirm a sale from far outside the reported area.
export async function POST(request, { params }) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Confirming is not available right now.' }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'A real location is needed to confirm a sale.' }, { status: 400 });
  }

  const { data: spot, error: loadError } = await supabaseAdmin
    .from('spotted_sales')
    .select('*')
    .eq('id', params.id)
    .single();

  if (loadError || !spot) {
    return NextResponse.json({ error: 'That reported sale could not be found.' }, { status: 404 });
  }
  if (spot.status !== 'unconfirmed') {
    return NextResponse.json({ id: spot.id, lat: spot.lat, lng: spot.lng, status: spot.status, alreadyDone: true });
  }

  const { data: settingsRow } = await supabaseAdmin
    .from('app_settings')
    .select('spotted_sale_radius_ft')
    .eq('id', 1)
    .single();
  const radiusFt = Number.isFinite(settingsRow?.spotted_sale_radius_ft) ? settingsRow.spotted_sale_radius_ft : 300;
  // A bit more forgiving than the report-clustering radius -- GPS drifts,
  // and someone confirming on foot near the sale shouldn't get rejected
  // over a stray 50 feet.
  const confirmRadiusFt = radiusFt * 2;

  const distanceFt = (distanceMiles({ lat, lng }, { lat: spot.lat, lng: spot.lng }) || Infinity) * 5280;
  if (distanceFt > confirmRadiusFt) {
    return NextResponse.json(
      { error: "You'll need to be closer to the reported location to confirm it." },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from('spotted_sales')
    .update({
      status: 'confirmed',
      confirmation_method: 'visit',
      confirmed_at: new Date().toISOString(),
      lat,
      lng,
    })
    .eq('id', spot.id)
    .select('id, lat, lng, status')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...data, alreadyDone: false });
}
