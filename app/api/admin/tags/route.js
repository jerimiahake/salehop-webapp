import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Lists every tag -- public visitors read these directly via the anon
// client (RLS allows public select), same as ads. This admin route exists
// so the /admin Tags section has a consistent, auth-gated way to see and
// manage the same list.
export async function GET(request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin.from('tags').select('*').order('name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

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

  const name = (body?.name || '').trim();
  if (!name) {
    return NextResponse.json({ error: 'Tag name is required.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.from('tags').insert({ name }).select().single();

  if (error) {
    // Postgres unique_violation -- friendlier message than the raw error.
    if (error.code === '23505') {
      return NextResponse.json({ error: `"${name}" already exists.` }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
