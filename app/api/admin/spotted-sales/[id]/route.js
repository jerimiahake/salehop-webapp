import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Whatever the client sends, only these columns are ever written --
// same "allowlist" pattern as /api/admin/sales/[id].
const EDITABLE_FIELDS = ['status', 'lat', 'lng'];

export async function PATCH(request, { params }) {
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

  const updates = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) updates[field] = body[field];
  }
  if ('status' in updates) {
    if (!['unconfirmed', 'confirmed', 'rejected'].includes(updates.status)) {
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
    }
    // A manual admin approve/re-open still leaves a record of who made
    // the call, same spirit as `confirmation_method` for the crowd/visit
    // paths -- and stamps confirmed_at fresh each time it's set to
    // confirmed this way.
    if (updates.status === 'confirmed') {
      updates.confirmation_method = 'admin';
      updates.confirmed_at = new Date().toISOString();
    }
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('spotted_sales')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    id: data.id,
    lat: data.lat,
    lng: data.lng,
    status: data.status,
    confirmation_method: data.confirmation_method,
    report_count: (data.reporter_device_ids || []).length,
    first_reported_at: data.first_reported_at,
    last_reported_at: data.last_reported_at,
    confirmed_at: data.confirmed_at,
  });
}

export async function DELETE(request, { params }) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  const { error } = await supabaseAdmin.from('spotted_sales').delete().eq('id', params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
