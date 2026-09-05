import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Single-row app-wide settings (currently just ad_interval -- how often an
// ad card is mixed into the Browse list). Public visitors read this row
// directly via the anon client (RLS allows public select), same as ads/
// tags -- this admin route exists so /admin has an auth-gated way to
// change it.
export async function GET(request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin.from('app_settings').select('*').eq('id', 1).single();

  if (error) {
    // Table/row not there yet (schema-v8 migration not run) -- fall back
    // to the old hardcoded default rather than breaking the admin page.
    return NextResponse.json({ ad_interval: 4, migrationNeeded: true });
  }

  return NextResponse.json(data);
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

  const adInterval = Number(body?.ad_interval);
  if (!Number.isInteger(adInterval) || adInterval < 1 || adInterval > 50) {
    return NextResponse.json({ error: 'Ad frequency must be a whole number between 1 and 50.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ id: 1, ad_interval: adInterval })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
