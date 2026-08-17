import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Lists every sale regardless of status, for the /admin dashboard. Uses the
// service-role client, which bypasses Row Level Security entirely -- this
// is the one place in the app that's allowed to see pending/rejected sales
// that don't belong to the current visitor.
export async function GET(request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin
    .from('sales')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

// Creates a listing directly from the admin panel. Unlike a seller's own
// submission, this always comes back already 'approved' (no review needed
// -- the admin made it) and isn't attributed to any seller account
// (user_id stays null). status and user_id are hardcoded here rather than
// trusted from the request body, same defense-in-depth spirit as the
// EDITABLE_FIELDS allowlist in [id]/route.js.
export async function POST(request) {
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

  if (!body?.title || !body?.address || !body?.sale_date || !body?.start_time || !body?.end_time) {
    return NextResponse.json({ error: 'Missing required listing fields.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('sales')
    .insert({
      title: body.title,
      address: body.address,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      sale_date: body.sale_date,
      end_date: body.end_date || null,
      start_time: body.start_time,
      end_time: body.end_time,
      tags: body.tags || [],
      description: body.description || null,
      photo_urls: body.photo_urls || [],
      is_neighborhood_sale: Boolean(body.is_neighborhood_sale),
      neighborhood_name: body.is_neighborhood_sale ? body.neighborhood_name || null : null,
      status: 'approved',
      user_id: null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
