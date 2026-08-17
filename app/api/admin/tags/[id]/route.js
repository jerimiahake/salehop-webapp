import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Tags are add/remove only from the admin panel -- no rename, since a tag
// that's already in use on existing listings would silently change what
// those listings show. Deleting one just removes it from the picker for
// NEW/edited listings; existing sales keep whatever tags they already had
// (tags are stored per-sale as a plain text array, not a foreign key).
export async function DELETE(request, { params }) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  const { error } = await supabaseAdmin.from('tags').delete().eq('id', params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}