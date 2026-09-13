import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Single-row app-wide settings: ad_interval (how often an ad card is
// mixed into Browse), plus spotted_sale_radius_ft/spotted_sale_confirm_count
// (schema-v10 -- the crowdsourced "spotted a sale" feature's clustering
// radius and how many distinct reports auto-confirm a spot). Public
// visitors read this row directly via the anon client (RLS allows public
// select), same as ads/tags -- this admin route exists so /admin has an
// auth-gated way to change any of it.
export async function GET(request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin.from('app_settings').select('*').eq('id', 1).single();

  if (error || !data) {
    // Table/row not there yet (schema-v8 migration not run) -- fall back
    // to the old hardcoded defaults rather than breaking the admin page.
    return NextResponse.json({
      ad_interval: 4,
      spotted_sale_radius_ft: 300,
      spotted_sale_confirm_count: 3,
      migrationNeeded: true,
      spottedSettingsMigrationNeeded: true,
    });
  }

  // The row can exist (schema-v8 run) without the two schema-v10 columns
  // yet -- select('*') just omits them rather than erroring, so fill in
  // the same defaults the live app falls back to and flag it separately
  // from the whole-table `migrationNeeded` above.
  const spottedSettingsMigrationNeeded =
    data.spotted_sale_radius_ft === undefined || data.spotted_sale_confirm_count === undefined;

  return NextResponse.json({
    ...data,
    spotted_sale_radius_ft: data.spotted_sale_radius_ft ?? 300,
    spotted_sale_confirm_count: data.spotted_sale_confirm_count ?? 3,
    spottedSettingsMigrationNeeded,
  });
}

export async function PATCH(request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  // Each setting is optional here -- the Ad Frequency panel only ever
  // sends ad_interval, and the new Spotted Sales panel only ever sends
  // the two spotted_sale_* fields, so a save from either one doesn't
  // require also resending a value for the other.
  const updates = { id: 1 };

  if ('ad_interval' in body) {
    const adInterval = Number(body.ad_interval);
    if (!Number.isInteger(adInterval) || adInterval < 1 || adInterval > 50) {
      return NextResponse.json({ error: 'Ad frequency must be a whole number between 1 and 50.' }, { status: 400 });
    }
    updates.ad_interval = adInterval;
  }
  if ('spotted_sale_radius_ft' in body) {
    const radiusFt = Number(body.spotted_sale_radius_ft);
    if (!Number.isInteger(radiusFt) || radiusFt < 50 || radiusFt > 2000) {
      return NextResponse.json(
        { error: 'Spotted-sale radius must be a whole number between 50 and 2000 feet.' },
        { status: 400 }
      );
    }
    updates.spotted_sale_radius_ft = radiusFt;
  }
  if ('spotted_sale_confirm_count' in body) {
    const confirmCount = Number(body.spotted_sale_confirm_count);
    if (!Number.isInteger(confirmCount) || confirmCount < 2 || confirmCount > 10) {
      return NextResponse.json(
        { error: 'Confirm count must be a whole number between 2 and 10.' },
        { status: 400 }
      );
    }
    updates.spotted_sale_confirm_count = confirmCount;
  }

  if (Object.keys(updates).length === 1) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.from('app_settings').upsert(updates).select().single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
