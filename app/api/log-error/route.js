import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Fire-and-forget failure logging. Called from the sign-in form's and the
// listing form's catch blocks so a failure that only ever showed up on the
// visitor's own screen also leaves a trace Jerimiah can see in /admin.
//
// Deliberately quiet: this never throws, and always returns 200 with
// { ok: ... } rather than an error status, so a hiccup logging the error
// can never itself surface as a second, confusing error message on top of
// the real one the visitor already saw.
const VALID_KINDS = ['signup', 'listing'];

export async function POST(request) {
  try {
    if (!isSupabaseAdminConfigured) {
      return NextResponse.json({ ok: false });
    }

    const body = await request.json().catch(() => ({}));
    const kind = VALID_KINDS.includes(body?.kind) ? body.kind : 'listing';
    const message = (body?.message ? String(body.message) : 'Unknown error').slice(0, 2000);
    const email = body?.email ? String(body.email).slice(0, 320) : null;
    const context = body?.context && typeof body.context === 'object' ? body.context : null;

    await supabaseAdmin.from('error_reports').insert({ kind, message, email, context });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
