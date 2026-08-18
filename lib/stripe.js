import Stripe from 'stripe';

// Server-only Stripe client, used to create Checkout Sessions and verify
// webhook signatures. Mirrors lib/supabaseAdmin.js's pattern:
//   * Only ever import this from app/api/** route handlers.
//   * NEVER import it from a 'use client' component.
//   * NEVER give STRIPE_SECRET_KEY a NEXT_PUBLIC_ prefix -- that would
//     ship a real payments key to every visitor's browser.
//
// apiVersion is left unset on purpose -- the installed `stripe` package
// pins its own default API version, so there's no version string here to
// keep in sync by hand.
const secretKey = process.env.STRIPE_SECRET_KEY;

export const isStripeConfigured = Boolean(secretKey);

export const stripe = isStripeConfigured ? new Stripe(secretKey) : null;
