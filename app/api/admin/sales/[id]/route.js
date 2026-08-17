import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Whatever the client sends, only these columns are ever written -- this
// keeps a request from writing to something like user_id even if it tried.
const EDITABLE_FIELDS = [
  'title',
  'address',
  'lat',
  'lng',
  'sale_date',
  'start_time',
  'end_time',
  'tags',
  'description',
  'photo_urls',
  'status',
];

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
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }
  if ('status' in updates && !['pending', 'approved', 'rejected'].includes(updates.status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('sales')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(request, { params }) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  // Look up photo URLs first so we can also clean those up from storage --
  // deleting the row doesn't automatically delete its uploaded files.
  const { data: existing } = await supabaseAdmin
    .from('sales')
    .select('photo_urls')
    .eq('id', params.id)
    .single();

  const { error } = await supabaseAdmin.from('sales').delete().eq('id', params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (existing?.photo_urls?.length > 0) {
    const paths = existing.photo_urls.map((url) => url.split('/sale-photos/')[1]).filter(Boolean);
    if (paths.length > 0) {
      supabaseAdmin.storage.from('sale-photos').remove(paths).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}