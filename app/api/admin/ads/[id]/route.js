import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

const EDITABLE_FIELDS = [
  'title',
  'description',
  'image_url',
  'link_url',
  'sponsor_name',
  'active',
  'html_snippet',
  'location_type',
  'address',
  'lat',
  'lng',
  // Who (if anyone) can sign in and edit this ad themselves -- see
  // supabase/schema-v12-ad-ownership.sql. Only ever settable from here
  // (this route runs through the service-role connection, which bypasses
  // the RLS trigger that blocks an owner from changing their own
  // owner_email), never by the advertiser's own edit form.
  'owner_email',
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

  let { data, error } = await supabaseAdmin.from('ads').update(updates).eq('id', params.id).select().single();

  // 42703 = Postgres "undefined column" -- schema-v12-ad-ownership.sql
  // (which adds owner_email) hasn't been run yet. Rather than failing
  // this save entirely (even when owner_email wasn't the field someone
  // actually meant to change -- the admin panel's inline edit form always
  // includes it), silently drop just that one field and retry once, same
  // graceful-degradation pattern used elsewhere in this app.
  if (error?.code === '42703' && 'owner_email' in updates) {
    const { owner_email, ...withoutOwnerEmail } = updates;
    ({ data, error } = await supabaseAdmin.from('ads').update(withoutOwnerEmail).eq('id', params.id).select().single());
  }

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

  // Look up the image first so we can also clean it up from storage --
  // deleting the row doesn't automatically delete its uploaded file.
  const { data: existing } = await supabaseAdmin.from('ads').select('image_url').eq('id', params.id).single();

  const { error } = await supabaseAdmin.from('ads').delete().eq('id', params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (existing?.image_url) {
    const path = existing.image_url.split('/sale-photos/')[1];
    if (path) {
      supabaseAdmin.storage.from('sale-photos').remove([path]).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}
