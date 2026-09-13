import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

function storagePathFromUrl(url) {
  const marker = '/spotted-sale-photos/';
  const idx = url.indexOf(marker);
  return idx === -1 ? null : url.slice(idx + marker.length);
}

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

  // Photos/notes show up immediately with no approval step (see
  // app/api/spotted-sales/[id]/photos/route.js) -- this is the
  // after-the-fact moderation path for removing one that shouldn't be
  // there, without having to reject/delete the whole spotted sale.
  // `removePhotoUrl` needs a fresh read of the row (can't just splice a
  // client-sent array -- someone else could have added a photo since the
  // admin page last loaded), so these two are handled separately from the
  // plain-field updates above.
  let removePhotoUrl = typeof body.removePhotoUrl === 'string' ? body.removePhotoUrl : null;
  let removeNoteAt = Number.isInteger(body.removeNoteAt) ? body.removeNoteAt : null;

  if (removePhotoUrl || removeNoteAt !== null) {
    const { data: current, error: loadError } = await supabaseAdmin
      .from('spotted_sales')
      .select('photo_urls, notes')
      .eq('id', params.id)
      .single();
    if (loadError || !current) {
      return NextResponse.json({ error: 'That reported sale could not be found.' }, { status: 404 });
    }
    if (removePhotoUrl) {
      updates.photo_urls = (current.photo_urls || []).filter((url) => url !== removePhotoUrl);
      const path = storagePathFromUrl(removePhotoUrl);
      if (path) supabaseAdmin.storage.from('spotted-sale-photos').remove([path]).catch(() => {});
    }
    if (removeNoteAt !== null) {
      updates.notes = (current.notes || []).filter((_, i) => i !== removeNoteAt);
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
    photo_urls: data.photo_urls || [],
    notes: data.notes || [],
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

  // Best-effort cleanup of any uploaded photos -- not critical if it fails,
  // same approach as deleting a real listing's photos in AppShell.js.
  const { data: existing } = await supabaseAdmin.from('spotted_sales').select('photo_urls').eq('id', params.id).single();
  const paths = (existing?.photo_urls || []).map(storagePathFromUrl).filter(Boolean);
  if (paths.length > 0) {
    supabaseAdmin.storage.from('spotted-sale-photos').remove(paths).catch(() => {});
  }

  const { error } = await supabaseAdmin.from('spotted_sales').delete().eq('id', params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
