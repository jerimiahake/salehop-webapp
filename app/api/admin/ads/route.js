import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Lists every ad (active and inactive) for the /admin dashboard. Public
// visitors only ever see active ones (enforced by RLS on the "ads" table),
// but the admin panel needs to see and manage everything.
export async function GET(request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin
    .from('ads')
    .select('*')
    .order('created_at', { ascending: false });

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

  const adType = body?.ad_type === 'snippet' ? 'snippet' : 'image';

  if (!body?.title) {
    return NextResponse.json({ error: 'An ad needs a title.' }, { status: 400 });
  }
  if (adType === 'image' && !body?.link_url) {
    return NextResponse.json({ error: 'An image ad needs a link.' }, { status: 400 });
  }
  if (adType === 'snippet' && !body?.html_snippet) {
    return NextResponse.json({ error: 'A code-snippet ad needs the embed code.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('ads')
    .insert({
      ad_type: adType,
      title: body.title,
      description: body.description || null,
      image_url: adType === 'image' ? body.image_url || null : null,
      link_url: adType === 'image' ? body.link_url : null,
      sponsor_name: adType === 'image' ? body.sponsor_name || null : null,
      html_snippet: adType === 'snippet' ? body.html_snippet : null,
      active: true,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
