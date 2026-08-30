import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Public contact form (see app/contact/page.js). Always saves the message
// to the database first -- that's the guaranteed record. Sending the email
// notification below is best-effort on top of that: if it fails (no
// RESEND_API_KEY set yet, Resend having a bad day, whatever), the request
// still succeeds and the message still shows up in /admin's Support
// section, unread -- nothing is ever silently lost.
const NOTIFY_EMAIL = process.env.CONTACT_NOTIFY_EMAIL || 'admin@salehop.app';
const FROM_EMAIL = process.env.CONTACT_FROM_EMAIL || 'SaleHop <onboarding@resend.dev>';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const name = (body?.name || '').trim();
  const email = (body?.email || '').trim();
  const message = (body?.message || '').trim();

  if (!email || !message) {
    return NextResponse.json({ error: 'Please include your email and a message.' }, { status: 400 });
  }

  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }

  const { data: saved, error: insertError } = await supabaseAdmin
    .from('contact_messages')
    .insert({ name: name || null, email, message })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Best-effort email notification via Resend's plain REST API -- a
  // native fetch() call rather than adding the `resend` npm package as a
  // new dependency, same minimal-dependency approach used elsewhere in
  // this project (admin sessions via built-in crypto, QR codes generated
  // without a heavyweight image library).
  let emailSent = false;
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: NOTIFY_EMAIL,
          reply_to: email,
          subject: `SaleHop contact form: ${name || email}`,
          text: `From: ${name || '(no name given)'} <${email}>\n\n${message}`,
        }),
      });
      emailSent = res.ok;
    } catch {
      emailSent = false;
    }
  }

  if (emailSent) {
    await supabaseAdmin.from('contact_messages').update({ email_sent: true }).eq('id', saved.id);
  }

  return NextResponse.json({ ok: true, emailSent });
}
