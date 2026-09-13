import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

const USERNAME_RE = /^[a-zA-Z0-9 _-]{2,24}$/;

// Where BadgeUnlockModal.js's progressive profile-building actually
// lands -- a visitor earns a badge, gets asked for an email (required to
// "save" it) plus an optional username, and later, at a further
// milestone, an optional phone number. Every field here is optional on
// its own (the modal decides what to ask for and when); this route just
// merges in whatever's provided, same "only touch what's sent" shape as
// the ads PATCH route.
export async function POST(request) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Not available right now.' }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.slice(0, 100) : null;
  if (!deviceId) {
    return NextResponse.json({ error: 'Missing device id.' }, { status: 400 });
  }

  const updates = {};

  if (typeof body?.email === 'string' && body.email.trim()) {
    const email = body.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'That email doesn’t look right -- double-check it.' }, { status: 400 });
    }
    updates.email = email;
  }

  if (typeof body?.phone === 'string' && body.phone.trim()) {
    const phone = body.phone.trim();
    if (phone.replace(/[^0-9]/g, '').length < 7) {
      return NextResponse.json({ error: 'That phone number looks too short -- double-check it.' }, { status: 400 });
    }
    updates.phone = phone;
  }

  if (typeof body?.username === 'string' && body.username.trim()) {
    const username = body.username.trim();
    if (!USERNAME_RE.test(username)) {
      return NextResponse.json(
        { error: 'Usernames are 2-24 characters -- letters, numbers, spaces, - and _ only.' },
        { status: 400 }
      );
    }
    updates.username = username;
  }

  if ('marketingOptIn' in body) {
    updates.marketing_opt_in = Boolean(body.marketingOptIn);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('players')
    .upsert({ device_id: deviceId, ...updates }, { onConflict: 'device_id' })
    .select('username, email, phone, marketing_opt_in')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That username is already taken -- try another.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    username: data.username || null,
    email: data.email || null,
    phone: data.phone || null,
    marketingOptIn: Boolean(data.marketing_opt_in),
  });
}
