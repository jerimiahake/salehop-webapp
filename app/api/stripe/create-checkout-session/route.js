import { NextResponse } from 'next/server';
import { stripe, isStripeConfigured } from '@/lib/stripe';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';
import { SITE_URL } from '@/lib/site';

const FEATURE_PRICE_CENTS = 1000; // $10.00 -- pins a listing to the top of Browse until it ends

// Starts a Stripe Checkout Session for featuring one of the caller's own
// listings. The actual "mark it featured" happens in the webhook handler
// once payment clears (app/api/stripe/webhook/route.js) -- this route only
// ever creates the session and hands back its hosted checkout URL.
export async function POST(request) {
  if (!isStripeConfigured) {
    return NextResponse.json(
      { error: 'Payments aren’t set up yet on this site (missing STRIPE_SECRET_KEY).' },
      { status: 500 }
    );
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

  const saleId = body?.sale_id;
  if (!saleId) {
    return NextResponse.json({ error: 'Missing sale_id.' }, { status: 400 });
  }

  // This creates a real charge, so the caller is verified server-side via
  // their own Supabase access token (sent as a Bearer header) rather than
  // trusting anything in the request body -- the same token the client
  // already holds from supabase.auth.getSession().
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: 'Please sign in first.' }, { status: 401 });
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    return NextResponse.json({ error: 'Your session has expired -- please sign in again.' }, { status: 401 });
  }

  const { data: sale, error: saleError } = await supabaseAdmin
    .from('sales')
    .select('id, title, sale_date, end_date, status, user_id')
    .eq('id', saleId)
    .single();

  if (saleError || !sale) {
    return NextResponse.json({ error: 'Listing not found.' }, { status: 404 });
  }
  if (sale.user_id !== userData.user.id) {
    return NextResponse.json({ error: 'That listing doesn’t belong to this account.' }, { status: 403 });
  }
  if (sale.status === 'rejected') {
    return NextResponse.json(
      { error: 'This listing wasn’t approved, so it can’t be featured. Edit and resubmit it first.' },
      { status: 400 }
    );
  }

  // Paying also skips the manual review queue (see webhook), so a still-
  // pending listing gets a slightly different checkout description than an
  // already-live one.
  const skipsReview = sale.status !== 'approved';

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: FEATURE_PRICE_CENTS,
          product_data: {
            name: `Featured listing: ${sale.title}`,
            description: skipsReview
              ? 'Skips manual review and pins your sale to the top of Browse for everyone to see until it ends.'
              : 'Pins your sale to the top of Browse for everyone to see until it ends.',
          },
        },
        quantity: 1,
      },
    ],
    metadata: { sale_id: sale.id },
    success_url: `${SITE_URL}/?featured=success`,
    cancel_url: `${SITE_URL}/?featured=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
