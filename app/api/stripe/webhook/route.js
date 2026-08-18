import { NextResponse } from 'next/server';
import { stripe, isStripeConfigured } from '@/lib/stripe';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabaseAdmin';

// Stripe calls this directly (not the browser) once a Checkout Session
// finishes, so this is the only place a listing actually gets marked
// featured -- the client-side redirect back to the app is just a nice
// "you're done" landing page, not something this trusts on its own.
//
// Signature verification needs the exact raw request bytes Stripe sent, so
// this reads the body with request.text() rather than request.json() --
// parsing it as JSON first would change the bytes and break the signature
// check.
export async function POST(request) {
  if (!isStripeConfigured || !isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });
  }

  const signature = request.headers.get('stripe-signature');
  const rawBody = await request.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return NextResponse.json({ error: `Webhook signature verification failed: ${err.message}` }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const saleId = session.metadata?.sale_id;

    if (saleId) {
      // Stripe can (and does) retry webhook delivery -- this table doubles
      // as an idempotency check so a retried delivery doesn't extend
      // featured_until a second time or record the payment twice.
      const { data: existing } = await supabaseAdmin
        .from('feature_purchases')
        .select('id')
        .eq('stripe_session_id', session.id)
        .maybeSingle();

      if (!existing) {
        const { data: sale } = await supabaseAdmin
          .from('sales')
          .select('sale_date, end_date, status')
          .eq('id', saleId)
          .single();

        if (sale) {
          const featuredUntil = sale.end_date || sale.sale_date;

          // Paying $10 also skips the manual review queue -- a still-pending
          // listing goes straight to 'approved' here. create-checkout-session
          // already refused to start checkout for a 'rejected' listing, so
          // this only ever promotes 'pending' -> 'approved' or leaves an
          // already-'approved' listing as-is.
          await supabaseAdmin
            .from('sales')
            .update({ featured: true, featured_until: featuredUntil, status: 'approved' })
            .eq('id', saleId);

          await supabaseAdmin.from('feature_purchases').insert({
            sale_id: saleId,
            stripe_session_id: session.id,
            amount_cents: session.amount_total ?? 1000,
          });
        }
      }
    }
  }

  return NextResponse.json({ received: true });
}
