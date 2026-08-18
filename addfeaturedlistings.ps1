# Adds paid "Featured" listings ($10 via Stripe Checkout). A seller can
# pay to pin their listing to the top of Browse until it ends -- and if
# the listing is still waiting on review, paying also skips the wait and
# publishes it immediately (a real, cleared $10 payment is the bypass;
# nothing free-form gets around review).
#
# This round adds the project's first new package (the "stripe" npm
# package), a new database migration (schema-v5-featured-listings.sql --
# run that FIRST in the Supabase SQL Editor, separately, before running
# this script), and two new server routes that need a Stripe secret key
# set in Vercel. See the setup notes sent alongside this script for the
# Stripe-specific steps -- this script alone is not enough to make
# payments actually work, but it's safe to run any time.
#
# Safe to re-run if something fails partway through.

$projectPath = "C:\Users\Bastian\Documents\WebDesign\SaleHop-app\salehopproject\salehop"

Write-Host "Moving into $projectPath ..." -ForegroundColor Cyan
if (-not (Test-Path $projectPath)) {
    Write-Host "ERROR: That folder doesn't exist. Double-check the path and edit it at the top of this script." -ForegroundColor Red
    exit 1
}
Set-Location $projectPath

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: git isn't installed (or not on PATH)." -ForegroundColor Red
    exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: npm isn't installed (or not on PATH)." -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Force -Path "lib" | Out-Null
New-Item -ItemType Directory -Force -Path "app\api\stripe\create-checkout-session" | Out-Null
New-Item -ItemType Directory -Force -Path "app\api\stripe\webhook" | Out-Null
New-Item -ItemType Directory -Force -Path "components" | Out-Null
New-Item -ItemType Directory -Force -Path "app\admin" | Out-Null

Write-Host "Installing the Stripe package (this project's first new dependency) ..." -ForegroundColor Cyan
npm install stripe

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: npm install stripe failed -- scroll up for the error and send it to me before continuing." -ForegroundColor Red
    exit 1
}

Write-Host "Writing lib\stripe.js ..." -ForegroundColor Cyan
@'
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
'@ | Set-Content -Encoding UTF8 "lib\stripe.js"

Write-Host "Writing lib\supabaseAdmin.js ..." -ForegroundColor Cyan
@'
import { createClient } from '@supabase/supabase-js';

// Server-only Supabase client using the service role key, which bypasses
// Row Level Security entirely. It has full read/write access to every
// table, so:
//   * Only import this file from server-only API routes under app/api/**
//     (e.g. app/api/admin/**, app/api/stripe/**).
//   * NEVER import it from a 'use client' component.
//   * NEVER give SUPABASE_SERVICE_ROLE_KEY a NEXT_PUBLIC_ prefix -- that
//     would ship it to every visitor's browser.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const isSupabaseAdminConfigured = Boolean(supabaseUrl && serviceRoleKey);

export const supabaseAdmin = isSupabaseAdminConfigured
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;
'@ | Set-Content -Encoding UTF8 "lib\supabaseAdmin.js"

Write-Host "Writing app\api\stripe\create-checkout-session\route.js ..." -ForegroundColor Cyan
@'
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
'@ | Set-Content -Encoding UTF8 "app\api\stripe\create-checkout-session\route.js"

Write-Host "Writing app\api\stripe\webhook\route.js ..." -ForegroundColor Cyan
@'
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
'@ | Set-Content -Encoding UTF8 "app\api\stripe\webhook\route.js"

Write-Host "Writing components\AppShell.js ..." -ForegroundColor Cyan
@'
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { sampleSales, MAP_CENTER } from '@/lib/sampleData';
import { nextNDays, distanceMiles, toDateKey, dateInRange } from '@/lib/format';
import BrowseScreen from './BrowseScreen';
import MapScreen from './MapScreen';
import PostScreen from './PostScreen';
import SavedScreen from './SavedScreen';
import AccountScreen from './AccountScreen';
import BottomNav from './BottomNav';
import Toast from './Toast';

const FAVORITES_KEY = 'salehop:favorites';

export default function AppShell() {
  const [activeScreen, setActiveScreen] = useState('browse');
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [ads, setAds] = useState([]);
  const dayOptions = useMemo(() => nextNDays(7), []);
  // Multi-select: most sales run 2-3 days, so Browse lets you pick several
  // days at once and see anything running on any of them. Always at least
  // one day selected -- toggleDate below guards against clearing the last one.
  const [selectedDates, setSelectedDates] = useState(() => [toDateKey(new Date())]);
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState([]);
  const [selectedSaleId, setSelectedSaleId] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [toast, setToast] = useState(null);
  const [session, setSession] = useState(null);
  const [editingListing, setEditingListing] = useState(false);

  const showToast = useCallback((message) => {
    setToast({ message, key: Date.now() });
  }, []);

  // Track the signed-in seller's session (magic-link auth). Supabase's
  // client persists the session in localStorage and also picks up the
  // token from the URL automatically when someone lands here after
  // clicking their magic-link email -- both are reflected here.
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load sales (from Supabase once configured, sample data until then).
  useEffect(() => {
    let cancelled = false;

    async function loadSales() {
      if (!isSupabaseConfigured) {
        setSales(sampleSales);
        setLoading(false);
        return;
      }
      setLoading(true);
      const { data, error } = await supabase
        .from('sales')
        .select('*')
        .eq('status', 'approved')
        .order('sale_date', { ascending: true });

      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        setSales([]);
      } else {
        setSales(data || []);
      }
      setLoading(false);
    }

    loadSales();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load active ads (sponsored cards mixed into Browse). Not critical if
  // this fails or Supabase isn't configured yet -- the app just shows no
  // ads rather than breaking anything.
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let cancelled = false;

    supabase
      .from('ads')
      .select('*')
      .eq('active', true)
      .then(({ data, error }) => {
        if (cancelled || error) return;
        setAds(data || []);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Load saved favorites (route stops) from this browser -- no account needed.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FAVORITES_KEY);
      if (raw) setFavorites(JSON.parse(raw));
    } catch {
      // ignore malformed/blocked storage
    }
  }, []);

  // Stripe redirects back here (full page reload) after a "Feature this
  // listing" checkout finishes -- success_url/cancel_url in
  // /api/stripe/create-checkout-session both just point at "/" with a
  // ?featured=... marker. This picks that up once on mount, shows a toast,
  // jumps to Account (where the listing lives), and then strips the query
  // param so refreshing/sharing the URL later doesn't replay the message.
  // The actual "mark it featured" already happened server-side in the
  // Stripe webhook by the time this redirect lands -- this is just the
  // user-facing landing, not what does the marking.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const featured = params.get('featured');
    if (!featured) return;

    if (featured === 'success') {
      showToast('🌟 Payment received -- your listing is now featured at the top of Browse!');
      setActiveScreen('account');
    } else if (featured === 'cancelled') {
      setActiveScreen('account');
    }

    params.delete('featured');
    const rest = params.toString();
    window.history.replaceState({}, '', rest ? `?${rest}` : window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Best-effort location for distance sorting; silently no-ops if denied.
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 8000 }
    );
  }, []);

  const persistFavorites = useCallback((next) => {
    setFavorites(next);
    try {
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const toggleFavorite = useCallback(
    (id) => {
      const next = favorites.includes(id)
        ? favorites.filter((x) => x !== id)
        : [...favorites, id];
      persistFavorites(next);
    },
    [favorites, persistFavorites]
  );

  const moveFavorite = useCallback(
    (id, direction) => {
      const idx = favorites.indexOf(id);
      if (idx === -1) return;
      const swapWith = idx + direction;
      if (swapWith < 0 || swapWith >= favorites.length) return;
      const next = [...favorites];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      persistFavorites(next);
    },
    [favorites, persistFavorites]
  );

  const referenceLocation = userLocation || MAP_CENTER;

  // Toggle a day pill on/off, but never down to zero selected days --
  // Browse always needs at least one day to filter against.
  const toggleDate = useCallback((date) => {
    setSelectedDates((prev) => {
      if (prev.includes(date)) {
        if (prev.length === 1) return prev;
        return prev.filter((d) => d !== date);
      }
      return [...prev, date];
    });
  }, []);

  const filteredSales = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const todayKey = toDateKey(new Date());
    return sales
      .filter((s) => selectedDates.some((d) => dateInRange(d, s.sale_date, s.end_date)))
      .filter((s) => {
        if (!q) return true;
        return (
          s.title.toLowerCase().includes(q) ||
          s.address.toLowerCase().includes(q) ||
          (s.neighborhood_name || '').toLowerCase().includes(q)
        );
      })
      .map((s) => ({
        ...s,
        distance: distanceMiles(referenceLocation, s),
        // "Featured" until the paid-for window (set by the Stripe webhook,
        // see supabase/schema-v5-featured-listings.sql) actually lapses --
        // the `featured` flag alone can stay true past that date, this is
        // what both the sort below and the badge in SaleCard/ListingSheet
        // actually check.
        isFeatured: Boolean(s.featured && s.featured_until && s.featured_until >= todayKey),
      }))
      .sort((a, b) => {
        if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
        return (a.distance ?? 0) - (b.distance ?? 0);
      });
  }, [sales, selectedDates, searchQuery, referenceLocation]);

  const favoritedSales = useMemo(
    () => favorites.map((id) => sales.find((s) => s.id === id)).filter(Boolean),
    [favorites, sales]
  );

  function openSaleOnMap(id) {
    setSelectedSaleId(id);
    setActiveScreen('map');
  }

  function handlePublished(message) {
    setActiveScreen('browse');
    showToast(message || '🎉 Thanks! Your sale was submitted and is awaiting a quick review before it goes live.');
  }

  return (
    <div className="device">
      <div className="notch" />
      <div className="app-screens">
        <div className={`screen ${activeScreen === 'browse' ? 'active' : ''}`}>
          <BrowseScreen
            sales={filteredSales}
            ads={ads}
            loading={loading}
            loadError={loadError}
            dayOptions={dayOptions}
            selectedDates={selectedDates}
            onToggleDate={toggleDate}
            searchQuery={searchQuery}
            onSearch={setSearchQuery}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            onOpenSale={openSaleOnMap}
          />
        </div>
        <div className={`screen ${activeScreen === 'map' ? 'active' : ''}`}>
          <MapScreen
            sales={filteredSales}
            favorites={favorites}
            selectedSaleId={selectedSaleId}
            onSelectSale={setSelectedSaleId}
            onToggleFavorite={toggleFavorite}
            favoritedSales={favoritedSales}
            onOpenSaved={() => setActiveScreen('saved')}
            center={referenceLocation}
            active={activeScreen === 'map'}
          />
        </div>
        <div className={`screen ${activeScreen === 'post' ? 'active' : ''}`}>
          <PostScreen
            session={session}
            onCancel={() => setActiveScreen('browse')}
            onPublished={handlePublished}
            onGoToAccount={() => setActiveScreen('account')}
          />
        </div>
        <div className={`screen ${activeScreen === 'saved' ? 'active' : ''}`}>
          <SavedScreen
            favoritedSales={favoritedSales}
            onRemove={toggleFavorite}
            onMove={moveFavorite}
            showToast={showToast}
          />
        </div>
        <div className={`screen ${activeScreen === 'account' ? 'active' : ''}`}>
          <AccountScreen session={session} showToast={showToast} onEditingChange={setEditingListing} />
        </div>
      </div>

      <BottomNav
        active={activeScreen}
        onChange={setActiveScreen}
        savedCount={favorites.length}
        hidden={editingListing}
      />
      <Toast toast={toast} />
    </div>
  );
}
'@ | Set-Content -Encoding UTF8 "components\AppShell.js"

Write-Host "Writing components\AccountScreen.js ..." -ForegroundColor Cyan
@'
'use client';

import { useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { formatTimeRange, formatDateRange, toDateKey } from '@/lib/format';
import { SITE_URL } from '@/lib/site';
import ListingForm from './ListingForm';
import ShareToFacebookButton from './ShareToFacebookButton';

const STATUS_LABEL = { pending: 'Pending Review', approved: 'Live', rejected: 'Not Approved' };

export default function AccountScreen({ session, showToast, onEditingChange }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [authError, setAuthError] = useState(null);

  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [editingSale, setEditingSale] = useState(null);
  // Bumped after a delete/edit completes to trigger a refetch below, without
  // needing loadListings itself in the effect's dependency array.
  const [refreshKey, setRefreshKey] = useState(0);
  // id of whichever listing's "Feature — $10" button was just tapped, so
  // only that one button shows a loading state while checkout starts.
  const [featuringId, setFeaturingId] = useState(null);

  // Let AppShell know whether we're mid-edit, so it can hide the bottom nav
  // the same way it does during Post -- tapping away mid-edit would
  // otherwise silently discard unsaved changes.
  useEffect(() => {
    onEditingChange?.(Boolean(editingSale));
    return () => onEditingChange?.(false);
  }, [editingSale, onEditingChange]);

  useEffect(() => {
    if (!session || !isSupabaseConfigured) return;
    let cancelled = false;

    async function loadListings() {
      setLoading(true);
      const { data, error } = await supabase
        .from('sales')
        .select('*')
        .eq('user_id', session.user.id)
        .order('sale_date', { ascending: false });

      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
      } else {
        setLoadError(null);
        setListings(data || []);
      }
      setLoading(false);
    }

    loadListings();
    return () => {
      cancelled = true;
    };
  }, [session, refreshKey]);

  async function handleSendLink() {
    if (!email.trim()) return;
    setSending(true);
    setAuthError(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
        },
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      setAuthError(err.message || 'Something went wrong sending your link.');
    } finally {
      setSending(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setListings([]);
    setSent(false);
    setEmail('');
  }

  async function handleDelete(sale) {
    const confirmed = window.confirm(`Delete "${sale.title}"? This can't be undone.`);
    if (!confirmed) return;
    try {
      const { error: deleteError } = await supabase.from('sales').delete().eq('id', sale.id);
      if (deleteError) throw deleteError;

      // Best-effort cleanup of any uploaded photos -- not critical if it fails.
      if (sale.photo_urls && sale.photo_urls.length > 0) {
        const paths = sale.photo_urls.map((url) => url.split('/sale-photos/')[1]).filter(Boolean);
        if (paths.length > 0) {
          supabase.storage.from('sale-photos').remove(paths).catch(() => {});
        }
      }

      setListings((ls) => ls.filter((l) => l.id !== sale.id));
      showToast?.('Listing deleted.');
    } catch (err) {
      showToast?.(`Couldn't delete that listing: ${err.message}`);
    }
  }

  function handleEditDone(message) {
    setEditingSale(null);
    setRefreshKey((k) => k + 1);
    showToast?.(message);
  }

  // Starts a Stripe Checkout Session for pinning this listing to the top
  // of Browse for $10, then redirects the whole tab to Stripe's hosted
  // checkout page. The listing doesn't actually get marked featured until
  // the Stripe webhook confirms payment server-side (see
  // app/api/stripe/webhook/route.js) -- this only ever starts checkout.
  async function handleFeature(sale) {
    setFeaturingId(sale.id);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Please sign in again.');

      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sale_id: sale.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start checkout.');
      window.location.href = data.url;
    } catch (err) {
      showToast?.(`Couldn't start checkout: ${err.message}`);
      setFeaturingId(null);
    }
  }

  // ---------- Editing an existing listing ----------
  if (session && editingSale) {
    return (
      <ListingForm
        mode="edit"
        session={session}
        initialSale={editingSale}
        onCancel={() => setEditingSale(null)}
        onDone={handleEditDone}
      />
    );
  }

  // ---------- Signed out: email + magic link ----------
  if (!session) {
    return (
      <>
        <div className="header" style={{ borderBottomColor: 'var(--yellow)' }}>
          <div className="header-row">
            <div className="logo marker-font" style={{ fontSize: 17 }}>
              Your <span>Account</span>
            </div>
          </div>
        </div>

        <div className="account-scroll">
          <div className="field-group">
            <p className="field-label">Sign In</p>
            <p className="hint" style={{ marginBottom: 12 }}>
              Enter your email and we&apos;ll send you a one-click sign-in link — no password to remember.
            </p>

            {sent ? (
              <div className="empty-state">
                <div className="big">📬</div>
                Check <b>{email}</b> for your sign-in link, then come back to this tab.
                <div style={{ marginTop: 14 }}>
                  <button type="button" className="chip" onClick={() => setSent(false)}>
                    Use a different email
                  </button>
                </div>
              </div>
            ) : (
              <>
                <input
                  className="text-input"
                  type="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendLink()}
                />
                {authError && <p className="error-hint">{authError}</p>}
                <button
                  type="button"
                  className="publish-btn"
                  style={{ width: 'auto', display: 'inline-block', marginTop: 12, padding: '12px 22px' }}
                  disabled={sending || !email.trim()}
                  onClick={handleSendLink}
                >
                  {sending ? 'Sending…' : 'Send Magic Link →'}
                </button>
              </>
            )}
          </div>
        </div>
      </>
    );
  }

  // ---------- Signed in: profile + My Listings ----------
  return (
    <>
      <div className="header" style={{ borderBottomColor: 'var(--yellow)' }}>
        <div className="header-row">
          <div className="logo marker-font" style={{ fontSize: 17 }}>
            Your <span>Account</span>
          </div>
        </div>
      </div>

      <div className="account-scroll">
        <div className="account-you">
          <span>
            Signed in as <b>{session.user.email}</b>
          </span>
          <button type="button" className="chip" onClick={handleSignOut}>
            Sign Out
          </button>
        </div>

        <div className="sidebar-label" style={{ marginTop: 18 }}>My Listings</div>

        {loading && <div className="empty-state">Loading your listings…</div>}

        {!loading && loadError && (
          <div className="empty-state">
            <div className="big">⚠️</div>
            Couldn&apos;t load your listings right now.
            <br />
            {loadError}
          </div>
        )}

        {!loading && !loadError && listings.length === 0 && (
          <div className="empty-state">
            <div className="big">📋</div>
            You haven&apos;t posted any sales yet. Tap Post below to get started.
          </div>
        )}

        {!loading &&
          !loadError &&
          listings.map((sale) => {
            const isCurrentlyFeatured = Boolean(
              sale.featured && sale.featured_until && sale.featured_until >= toDateKey(new Date())
            );
            return (
              <div className="my-listing-card" key={sale.id}>
                <div className={`status-badge ${sale.status}`}>{STATUS_LABEL[sale.status] || sale.status}</div>
                <p className="card-title">{sale.title}</p>
                <p className="card-addr">{sale.address}</p>
                <p className="card-addr">
                  {formatDateRange(sale.sale_date, sale.end_date)} · {formatTimeRange(sale.start_time, sale.end_time)}
                </p>
                {isCurrentlyFeatured && (
                  <p className="featured-status">⭐ Featured until {sale.featured_until}</p>
                )}
                {sale.status === 'pending' && !isCurrentlyFeatured && (
                  <p className="hint" style={{ margin: '4px 0 0' }}>
                    Waiting on review — or pay $10 to feature it and skip the wait, live right away.
                  </p>
                )}
                <div className="my-listing-actions">
                  <button type="button" className="chip" onClick={() => setEditingSale(sale)}>
                    Edit
                  </button>
                  {sale.status === 'approved' && (
                    <ShareToFacebookButton
                      url={`${SITE_URL}/listing/${sale.id}`}
                      quote={sale.title}
                      className="chip"
                      label="Share"
                    />
                  )}
                  {sale.status !== 'rejected' && !isCurrentlyFeatured && (
                    <button
                      type="button"
                      className="chip featured-chip"
                      disabled={featuringId === sale.id}
                      onClick={() => handleFeature(sale)}
                    >
                      {featuringId === sale.id
                        ? 'Starting checkout…'
                        : sale.status === 'pending'
                        ? '⭐ Skip Wait & Feature — $10'
                        : '⭐ Feature — $10'}
                    </button>
                  )}
                  <button type="button" className="chip danger" onClick={() => handleDelete(sale)}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
      </div>
    </>
  );
}
'@ | Set-Content -Encoding UTF8 "components\AccountScreen.js"

Write-Host "Writing components\SaleCard.js ..." -ForegroundColor Cyan
@'
'use client';

import { formatTimeRange, formatDateRange } from '@/lib/format';

export default function SaleCard({ sale, favorited, routeNum, onClick, onToggleFavorite, onFilterNeighborhood }) {
  const time = sale.time || (sale.start_time ? formatTimeRange(sale.start_time, sale.end_time) : '');
  const cover = sale.photo_urls && sale.photo_urls.length > 0 ? sale.photo_urls[0] : null;
  // Only shown once a sale actually has a real sale_date to range from --
  // sample/demo sales that only set `time` (no sale_date) skip it.
  const dateRange = sale.sale_date ? formatDateRange(sale.sale_date, sale.end_date) : null;

  return (
    <div className={`card ${favorited ? 'favorited' : ''} ${sale.isFeatured ? 'featured' : ''}`} onClick={onClick}>
      {favorited && <div className="route-num">{routeNum}</div>}
      <div className="thumb" style={{ background: favorited ? '#e4f0e6' : '#faf1d8' }}>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" />
        ) : (
          sale.icon || '🏷️'
        )}
      </div>
      <div className="card-body">
        <p className="card-title">{sale.title}</p>
        <p className="card-addr">
          {sale.address}
          {Number.isFinite(sale.distance) ? ` · ${sale.distance.toFixed(1)} mi` : ''}
        </p>
        <div className="card-meta">
          {sale.isFeatured && <span className="featured-badge">⭐ Featured</span>}
          {dateRange && <span className="time-badge mono">{dateRange}</span>}
          <span className="time-badge mono">{time}</span>
          {(sale.tags || []).map((t) => (
            <span className="tag" key={t}>
              {t}
            </span>
          ))}
        </div>
        {sale.is_neighborhood_sale && sale.neighborhood_name && (
          <button
            type="button"
            className="neighborhood-badge"
            onClick={(e) => {
              e.stopPropagation();
              onFilterNeighborhood?.(sale.neighborhood_name);
            }}
          >
            🏘️ Part of {sale.neighborhood_name}
          </button>
        )}
      </div>
      <button
        type="button"
        className={`fav-btn ${favorited ? 'on' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(sale.id);
        }}
        aria-label={favorited ? 'Remove from route' : 'Add to route'}
      >
        ★
      </button>
    </div>
  );
}
'@ | Set-Content -Encoding UTF8 "components\SaleCard.js"

Write-Host "Writing components\ListingSheet.js ..." -ForegroundColor Cyan
@'
'use client';

import { useEffect, useRef, useState } from 'react';
import { formatTimeRange, formatDateRange } from '@/lib/format';

const HALF_FRACTION = 0.42;
const FULL_FRACTION = 0.88;
const DISMISS_FRACTION = 0.2;
const TAP_THRESHOLD_PX = 6; // pointer movement under this counts as a tap, not a drag

// A draggable bottom sheet over the map. Tapping a sale (from Browse, or a
// pin on the map itself) opens this parked at "half" height showing a
// compact preview. Dragging (or tapping) the handle bar expands it to
// "full" (photos + full description) or collapses it back to "half";
// dragging past a dismiss threshold closes it entirely, same as the X
// button.
//
// Height changes are applied directly to the DOM node during a drag (via
// sheetRef), not through React state, so every pointermove doesn't trigger
// a re-render -- state ("mode") only updates once the drag settles, which
// keeps the gesture smooth on a real phone. The sheet's wrapper div is
// always rendered (even before any sale has ever been selected) so
// sheetRef.current already exists the first time a sale opens -- otherwise
// that very first open couldn't animate in.
export default function ListingSheet({ sale, favorited, onToggleFavorite, onClose, containerRef }) {
  const sheetRef = useRef(null);
  const [activeSale, setActiveSale] = useState(sale || null);
  const [mode, setMode] = useState('closed'); // 'closed' | 'half' | 'full'
  const dragState = useRef(null); // { startY, startHeight, moved } while a drag is in progress

  useEffect(() => {
    if (sale) {
      setActiveSale(sale);
      applyHeight(heightFor('half'), true);
      setMode('half');
    } else {
      applyHeight(0, true);
      setMode('closed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale?.id]);

  function containerHeight() {
    return containerRef.current?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 800);
  }

  function heightFor(m) {
    const h = containerHeight();
    if (m === 'full') return h * FULL_FRACTION;
    if (m === 'half') return h * HALF_FRACTION;
    return 0;
  }

  function applyHeight(px, animate) {
    const el = sheetRef.current;
    if (!el) return;
    el.classList.toggle('dragging', !animate);
    el.style.height = `${px}px`;
    if (!animate) {
      // Next frame, let the CSS transition resume for future (non-drag)
      // height changes -- keeping it off for one frame avoids the browser
      // trying to animate the drag's own manual updates.
      requestAnimationFrame(() => el.classList.remove('dragging'));
    }
  }

  function settle(nextMode) {
    setMode(nextMode);
    applyHeight(heightFor(nextMode), true);
    if (nextMode === 'closed') onClose?.();
  }

  function handlePointerDown(e) {
    dragState.current = { startY: e.clientY, startHeight: heightFor(mode), moved: 0 };
    applyHeight(heightFor(mode), false);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e) {
    const drag = dragState.current;
    if (!drag) return;
    const delta = e.clientY - drag.startY; // positive = moving down
    drag.moved = Math.max(drag.moved, Math.abs(delta));
    const h = containerHeight();
    const next = Math.max(0, Math.min(h * 0.96, drag.startHeight - delta));
    applyHeight(next, false);
  }

  function handlePointerUp() {
    const drag = dragState.current;
    dragState.current = null;
    if (!drag) return;

    if (drag.moved < TAP_THRESHOLD_PX) {
      // A tap on the handle, not a drag -- toggle instead of snapping to
      // whatever the pointer position happened to be.
      settle(mode === 'full' ? 'half' : 'full');
      return;
    }

    const h = containerHeight();
    const currentPx = sheetRef.current?.getBoundingClientRect().height ?? 0;
    if (currentPx < h * DISMISS_FRACTION) {
      settle('closed');
      return;
    }
    const midpoint = h * ((HALF_FRACTION + FULL_FRACTION) / 2);
    settle(currentPx > midpoint ? 'full' : 'half');
  }

  const cover = activeSale?.photo_urls && activeSale.photo_urls.length > 0 ? activeSale.photo_urls[0] : null;
  const dateRange = activeSale?.sale_date ? formatDateRange(activeSale.sale_date, activeSale.end_date) : null;
  const time = activeSale
    ? activeSale.time || (activeSale.start_time ? formatTimeRange(activeSale.start_time, activeSale.end_time) : '')
    : '';

  return (
    <div ref={sheetRef} className="listing-sheet" style={{ height: 0 }}>
      {activeSale && (
        <>
          <div
            className="sheet-drag-zone"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <div className="sheet-handle" />
            <div className="sheet-head">
              <div className="thumb" style={{ background: favorited ? '#e4f0e6' : '#faf1d8' }}>
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover} alt="" />
                ) : (
                  activeSale.icon || '🏷️'
                )}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className="card-title">{activeSale.title}</p>
                <p className="card-addr">{activeSale.address}</p>
                <div className="card-meta">
                  {activeSale.isFeatured && <span className="featured-badge">⭐ Featured</span>}
                  {dateRange && <span className="time-badge mono">{dateRange}</span>}
                  {time && <span className="time-badge mono">{time}</span>}
                </div>
              </div>
              <button
                type="button"
                className={`sheet-fav ${favorited ? 'on' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite?.(activeSale.id);
                }}
                aria-label={favorited ? 'Remove from route' : 'Add to route'}
              >
                ★
              </button>
            </div>
            <div className="expand-hint">
              {mode === 'full' ? '▼ drag or tap to collapse ▼' : '▲ drag or tap to expand ▲'}
            </div>
          </div>

          <div className="sheet-scroll">
            {activeSale.is_neighborhood_sale && activeSale.neighborhood_name && (
              <div className="neighborhood-badge" style={{ cursor: 'default', marginTop: 0, marginBottom: 12 }}>
                🏘️ Part of {activeSale.neighborhood_name}
              </div>
            )}

            {(activeSale.tags || []).length > 0 && (
              <div className="card-meta" style={{ marginBottom: 4 }}>
                {activeSale.tags.map((t) => (
                  <span className="tag" key={t}>
                    {t}
                  </span>
                ))}
              </div>
            )}

            {activeSale.photo_urls && activeSale.photo_urls.length > 0 && (
              <>
                <div className="sheet-section-label">Photos</div>
                <div className="sheet-photos">
                  {activeSale.photo_urls.map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={url} src={url} alt="" className="sheet-photo" />
                  ))}
                </div>
              </>
            )}

            {activeSale.description && (
              <>
                <div className="sheet-section-label">Description</div>
                <p className="sheet-desc">{activeSale.description}</p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
'@ | Set-Content -Encoding UTF8 "components\ListingSheet.js"

Write-Host "Writing app\globals.css ..." -ForegroundColor Cyan
@'
@import url('https://fonts.googleapis.com/css2?family=Permanent+Marker&family=DM+Sans:ital,wght@0,400;0,500;0,700;1,500&family=JetBrains+Mono:wght@500;700&display=swap');

:root {
  --paper: #FAF6EC;
  --ink: #201C16;
  --ink-soft: #5A5346;
  --yellow: #F4B93C;
  --yellow-deep: #E0A020;
  --red: #D64545;
  --green: #5C8A66;
  --tan: #E9DFC4;
  --line: #D8CDAA;
  --radius: 12px;
}

* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { height: 100%; margin: 0; padding: 0; }

body {
  background: #3a362e;
  color: var(--ink);
  font-family: 'DM Sans', sans-serif;
  -webkit-font-smoothing: antialiased;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px 0;
}

.marker-font { font-family: 'Permanent Marker', cursive; }
.mono { font-family: 'JetBrains Mono', monospace; }

/* ---------- DEVICE FRAME (desktop preview only) ---------- */
.device {
  width: 390px;
  height: 820px;
  background: var(--paper);
  border-radius: 44px;
  border: 8px solid #17140f;
  box-shadow: 0 30px 60px rgba(0,0,0,0.45);
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.notch {
  position: absolute; top: 0; left: 50%; transform: translateX(-50%);
  width: 120px; height: 26px; background: #17140f;
  border-radius: 0 0 16px 16px; z-index: 50;
}
@media (max-width: 480px) {
  /* min-height: 100vh here would measure the viewport as if the browser's
     address bar were fully collapsed -- taller than what's actually
     visible when it's showing. That mismatch made the whole page taller
     than the screen and pushed the bottom nav below the fold, needing a
     scroll to reach it. 100dvh tracks the real visible height instead
     (same fix already applied to .device below). */
  body { padding: 0; background: var(--paper); min-height: 100vh; min-height: 100dvh; }
  .device { width: 100%; height: 100vh; height: 100dvh; border-radius: 0; border: none; box-shadow: none; }
  .notch { display: none; }
}

/* ---------- ADMIN DASHBOARD OVERRIDE ---------- */
/* The rules above center everything inside a fixed-size phone frame for the
   mobile mockup. /admin is a normal desktop page (see AdminBodyClass.js),
   so it opts out of that layout entirely while mounted. */
body.admin-mode {
  display: block;
  min-height: 100vh;
  padding: 0;
  background: #f4f1ea;
}

/* ---------- SCREENS ---------- */
.app-screens { flex: 1; position: relative; overflow: hidden; }
.screen { position: absolute; inset: 0; display: none; flex-direction: column; background: var(--paper); }
.screen.active { display: flex; }

/* ---------- SHARED HEADER ---------- */
.header { background: var(--ink); color: var(--paper); padding: 16px 16px 12px; border-bottom: 4px solid var(--yellow); flex-shrink: 0; }
.header-row { display: flex; align-items: center; gap: 10px; }
.logo { font-size: 20px; color: var(--yellow); transform: rotate(-2deg); white-space: nowrap; }
.logo span { color: var(--paper); }
.icon-btn {
  width: 34px; height: 34px; border-radius: 50%;
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; color: var(--paper); flex-shrink: 0; cursor: pointer;
}
.search { margin-top: 10px; display: flex; align-items: center; gap: 8px; background: var(--paper); border-radius: 20px; padding: 9px 14px; color: var(--ink-soft); font-size: 13.5px; }
/* flex: 1 + min-width: 0 (not width: 100%) -- otherwise this item's flex
   basis is 100% of the whole row, which can shrink the search-clear button
   down to nothing/hide it once a long neighborhood name fills the input. */
.search input { border: none; background: none; outline: none; color: var(--ink); flex: 1; min-width: 0; font-family: inherit; font-size: 13.5px; }
.search-clear {
  flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%;
  border: none; background: rgba(32,28,22,0.12); color: var(--ink-soft);
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; cursor: pointer; padding: 0; font-family: inherit;
}
.search-clear:hover { background: rgba(32,28,22,0.2); color: var(--ink); }

/* A second, much more obvious way back to the full list -- shown right
   under "N sales near you" whenever a filter (typed search or a tapped
   neighborhood badge) is active. The small X inside the search box is
   easy to miss on a phone; this pill is not. */
.clear-filter-row { margin-top: 8px; }
.clear-filter-pill {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--yellow); color: var(--ink); border: none;
  padding: 7px 14px; border-radius: 20px; font-size: 12px; font-weight: 700;
  cursor: pointer; font-family: inherit;
}
.clear-filter-pill:hover { background: #ffcf5c; }
.day-pills { display: flex; gap: 6px; margin-top: 10px; overflow-x: auto; padding-bottom: 2px; }
.pill { padding: 6px 13px; border-radius: 20px; border: 1.5px solid #4b4437; color: #c9c2ae; font-size: 12.5px; font-weight: 700; white-space: nowrap; cursor: pointer; }
.pill.active { background: var(--yellow); color: var(--ink); border-color: var(--yellow); }
.count-row { display: flex; align-items: center; margin-top: 8px; font-size: 12px; color: #c9c2ae; }
.count-row b { color: var(--yellow); }

/* ---------- BROWSE: CARD LIST ---------- */
.list-scroll { flex: 1; overflow-y: auto; padding: 14px 14px 90px; }
.sidebar-label { font-size: 10.5px; letter-spacing: 1.3px; text-transform: uppercase; color: var(--ink-soft); font-weight: 700; margin: 2px 2px 10px; }
.empty-state { padding: 60px 20px; text-align: center; color: var(--ink-soft); font-size: 13.5px; }
.empty-state .big { font-size: 38px; margin-bottom: 10px; }

.card {
  display: flex; gap: 12px; background: #fff;
  border: 1.5px solid var(--line); border-left: 6px solid var(--yellow-deep);
  border-radius: var(--radius); padding: 12px; margin-bottom: 12px;
  position: relative; cursor: pointer;
}
/* Paid placement (see supabase/schema-v5-featured-listings.sql) -- a
   brighter left-border than the default card, plus the ".featured-badge"
   chip in .card-meta below. Comes before ".card.favorited" in the
   stylesheet on purpose: a sale can be both, and a personal "on my route"
   marker (green) is more useful to that one visitor than the paid-for
   badge, so favorited wins the border-color tiebreak when both apply. */
.card.featured { border-left-color: var(--yellow); }
.card.favorited { border-left-color: var(--green); }
.thumb { width: 52px; height: 52px; border-radius: 8px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 22px; overflow: hidden; }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.card-body { flex: 1; min-width: 0; }
.card-title { font-weight: 700; font-size: 14.5px; margin: 0 0 3px; }
.card-addr { font-size: 12px; color: var(--ink-soft); margin: 0 0 6px; }
.card-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.time-badge { font-size: 10.5px; font-weight: 700; background: var(--tan); padding: 3px 6px; border-radius: 5px; color: var(--ink); }
.featured-badge { font-size: 10.5px; font-weight: 800; letter-spacing: 0.2px; background: var(--yellow); color: var(--ink); padding: 3px 7px; border-radius: 5px; }
.tag { font-size: 10.5px; color: var(--ink-soft); background: var(--paper); border: 1px solid var(--line); padding: 3px 6px; border-radius: 5px; }
.fav-btn {
  position: absolute; top: 10px; right: 10px; width: 30px; height: 30px; border-radius: 50%;
  border: 1.5px solid var(--line); background: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 14px; color: var(--line);
}
.fav-btn.on { background: var(--green); border-color: var(--green); color: #fff; }
.route-num {
  position: absolute; top: -8px; left: -8px; width: 22px; height: 22px; border-radius: 50%;
  background: var(--red); color: #fff; font-family: 'JetBrains Mono'; font-size: 11px; font-weight: 700;
  display: none; align-items: center; justify-content: center; border: 2px solid var(--paper);
}
.card.favorited .route-num { display: flex; }

/* ---------- MAP SCREEN ---------- */
.map-wrap { flex: 1; position: relative; overflow: hidden; background: #DCE8D6; }
.leaflet-container { width: 100%; height: 100%; background: #DCE8D6; font-family: 'DM Sans', sans-serif; }
.map-floating-row { position: absolute; top: 12px; left: 12px; right: 12px; display: flex; gap: 8px; z-index: 500; pointer-events: none; }
.map-chip { background: rgba(32,28,22,0.85); color: var(--paper); font-size: 12px; padding: 8px 12px; border-radius: 20px; display: flex; align-items: center; gap: 6px; white-space: nowrap; border: 1px solid rgba(255,255,255,0.12); pointer-events: auto; }
.map-chip.grow { flex: 1; overflow: hidden; text-overflow: ellipsis; }

.sale-pin { background: none; border: none; }
.sale-pin .sign {
  width: 32px; height: 24px; background: var(--yellow); border: 2px solid var(--ink); border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  font-family: 'JetBrains Mono'; font-weight: 700; font-size: 11px;
  box-shadow: 2px 2px 0 rgba(32,28,22,0.18); margin: 0 auto;
}
.sale-pin .stick { width: 3px; height: 14px; background: var(--ink); margin: 0 auto; }
.sale-pin.favorited .sign { background: var(--green); color: #fff; border-color: #3d5f45; }
.sale-pin.favorited .stick { background: #3d5f45; }
.sale-pin.selected .sign { transform: translateY(-3px) scale(1.12); }

/* ---------- LISTING SHEET (draggable, over the map) ---------- */
/* Replaces the old static ".map-peek" card. Tapping a sale (from Browse,
   or a pin on the map) opens this parked at "half" height; the handle bar
   drags (or taps) it open to "full" -- photos + full description -- or
   closed. See components/ListingSheet.js for the drag logic; heights are
   applied there as inline styles, this just defines the visual chrome. */
.listing-sheet {
  position: absolute; left: 0; right: 0; bottom: 0;
  background: #fff; border-radius: 18px 18px 0 0;
  box-shadow: 0 -8px 24px rgba(32,28,22,0.22);
  z-index: 700; overflow: hidden;
  display: flex; flex-direction: column;
}
/* .dragging disables the transition for the duration of a live drag (set
   imperatively) so manual pointermove updates don't fight the animation;
   everything else (settling into half/full/closed, or the very first
   open) animates smoothly. */
.listing-sheet.dragging { transition: none !important; }
.listing-sheet:not(.dragging) { transition: height 0.28s cubic-bezier(.22,.88,.4,1); }

.sheet-drag-zone { flex-shrink: 0; padding-top: 8px; cursor: grab; touch-action: none; position: relative; }
.sheet-handle { width: 40px; height: 5px; border-radius: 3px; background: var(--line); margin: 0 auto 10px; }
.sheet-head { padding: 0 16px 10px; display: flex; gap: 12px; align-items: flex-start; }
.sheet-head .sheet-fav { margin-left: auto; }
.sheet-fav {
  width: 32px; height: 32px; border-radius: 50%; border: 1.5px solid var(--line); flex-shrink: 0;
  background: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer;
  font-size: 14px; color: var(--line);
}
.sheet-fav.on { background: var(--green); border-color: var(--green); color: #fff; }
.expand-hint { text-align: center; font-size: 11px; color: var(--ink-soft); padding: 2px 0 4px; }

.sheet-scroll { flex: 1; overflow-y: auto; padding: 0 16px 28px; -webkit-overflow-scrolling: touch; }
.sheet-section-label { font-size: 10.5px; letter-spacing: 1.1px; text-transform: uppercase; color: var(--ink-soft); font-weight: 700; margin: 16px 0 8px; }
.sheet-photos { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
.sheet-photo { width: 150px; height: 108px; border-radius: 10px; flex-shrink: 0; object-fit: cover; }
.sheet-desc { font-size: 13.5px; line-height: 1.55; color: var(--ink); margin: 0; white-space: pre-wrap; }

.route-pill {
  position: absolute; bottom: 12px; left: 12px; right: 12px;
  background: var(--ink); color: var(--paper);
  border-radius: 24px; padding: 12px 16px;
  display: flex; align-items: center; gap: 10px;
  font-size: 12.5px; font-weight: 700; cursor: pointer;
  box-shadow: 0 8px 20px rgba(32,28,22,0.3); z-index: 500; border: none; width: calc(100% - 24px);
}
.route-pill .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--red); flex-shrink: 0; }
.route-pill .go { margin-left: auto; color: var(--yellow); }

/* ---------- SAVED / ROUTE SCREEN ---------- */
.route-map-mini { height: 150px; position: relative; overflow: hidden; background: #DCE8D6; flex-shrink: 0; }
.route-list { flex: 1; overflow-y: auto; padding: 14px 16px 100px; }
.stop-row { display: flex; align-items: center; gap: 12px; background: #fff; border: 1.5px solid var(--line); border-radius: var(--radius); padding: 11px 12px; margin-bottom: 10px; }
.stop-row .handle { color: var(--line); font-size: 16px; cursor: grab; }
.stop-row .n { width: 22px; height: 22px; border-radius: 50%; background: var(--red); color: #fff; font-family: 'JetBrains Mono'; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.stop-row .stop-body { flex: 1; min-width: 0; }
.stop-row .stop-title { font-weight: 700; font-size: 13.5px; margin: 0 0 2px; }
.stop-row .stop-addr { font-size: 11.5px; color: var(--ink-soft); margin: 0; }
.stop-row .remove { color: var(--line); font-size: 16px; cursor: pointer; padding: 4px; background: none; border: none; }
.route-summary { padding: 12px 0; font-size: 12px; color: var(--ink-soft); border-top: 1.5px dashed var(--line); margin-top: 4px; }
.maps-export-row { display: flex; gap: 10px; margin-top: 14px; }
.maps-btn {
  flex: 1; border: none; padding: 14px 10px; border-radius: 14px; font-weight: 700; font-size: 13px;
  cursor: pointer; font-family: inherit; text-align: center; text-decoration: none; display: block;
}
.maps-btn.google { background: var(--yellow); color: var(--ink); }
.maps-btn.apple { background: var(--ink); color: var(--paper); }

/* ---------- BOTTOM NAV ---------- */
.bottom-nav { flex-shrink: 0; display: flex; align-items: center; justify-content: space-around; background: var(--ink); border-top: 2px solid #4b4437; padding: 8px 6px calc(10px + env(safe-area-inset-bottom)); }
.nav-btn { display: flex; flex-direction: column; align-items: center; gap: 3px; color: #8c8471; font-size: 10px; font-weight: 700; cursor: pointer; padding: 4px 10px; position: relative; background: none; border: none; }
.nav-btn .ic { font-size: 19px; }
.nav-btn.active { color: var(--yellow); }
.nav-btn .badge { position: absolute; top: -2px; right: 2px; background: var(--red); color: #fff; font-size: 9px; font-weight: 700; width: 15px; height: 15px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid var(--ink); }
.nav-btn.post .ic { width: 44px; height: 44px; border-radius: 50%; background: var(--yellow); color: var(--ink); display: flex; align-items: center; justify-content: center; font-size: 22px; margin-top: -22px; box-shadow: 0 4px 10px rgba(32,28,22,0.35); border: 4px solid var(--paper); }
.nav-btn.post { color: var(--ink-soft); }

/* ---------- POST SCREEN ---------- */
.post-header { background: var(--ink); color: var(--paper); padding: 14px 16px; display: flex; align-items: center; gap: 12px; border-bottom: 4px solid var(--yellow); flex-shrink: 0; }
.post-header .title { font-weight: 700; font-size: 15px; flex: 1; }
.post-scroll { flex: 1; overflow-y: auto; padding: 18px 16px 110px; }
.field-label { font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: var(--ink-soft); margin: 0 0 7px; }
.field-group { margin-bottom: 20px; }
.text-input, textarea {
  width: 100%; border: 1.5px solid var(--line); border-radius: 10px;
  padding: 12px 13px; font-family: inherit; font-size: 14px; color: var(--ink);
  background: #fff; outline: none;
}
.text-input:focus, textarea:focus { border-color: var(--yellow-deep); }
textarea { resize: vertical; min-height: 80px; }
.hint { font-size: 11.5px; color: var(--ink-soft); margin-top: 5px; }
.hint.address-verified { color: var(--green); font-weight: 600; }
.error-hint { font-size: 11.5px; color: var(--red); margin-top: 5px; }

.address-field { position: relative; }
.address-spinner {
  position: absolute; top: 50%; right: 13px; width: 14px; height: 14px; margin-top: -7px;
  border: 2px solid var(--line); border-top-color: var(--yellow-deep); border-radius: 50%;
  animation: address-spin 0.7s linear infinite;
}
@keyframes address-spin { to { transform: rotate(360deg); } }
.address-suggestions {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 50;
  background: #fff; border: 1.5px solid var(--line); border-radius: 10px;
  box-shadow: 0 8px 20px rgba(32,28,22,0.18); list-style: none; margin: 0; padding: 4px;
  max-height: 220px; overflow-y: auto;
}
.address-suggestion {
  display: block; width: 100%; text-align: left; background: none; border: none;
  padding: 9px 10px; font-family: inherit; font-size: 13px; color: var(--ink);
  border-radius: 7px; cursor: pointer; line-height: 1.35;
}
.address-suggestion.highlighted, .address-suggestion:hover { background: var(--tan); }
.time-row { display: flex; gap: 10px; align-items: center; }
.time-row .text-input { flex: 1; }
.time-row .to { color: var(--ink-soft); font-size: 12.5px; font-weight: 700; }
.chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { padding: 8px 14px; border-radius: 20px; border: 1.5px solid var(--line); background: #fff; font-size: 12.5px; font-weight: 600; color: var(--ink-soft); cursor: pointer; }
.chip.on { background: var(--yellow); border-color: var(--yellow-deep); color: var(--ink); }
.photo-row { display: flex; gap: 10px; flex-wrap: wrap; }
.photo-add { width: 72px; height: 72px; border-radius: 10px; border: 2px dashed var(--line); display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--ink-soft); font-size: 11px; cursor: pointer; gap: 2px; background: #fff; }
.photo-thumb { width: 72px; height: 72px; border-radius: 10px; background: var(--tan); display: flex; align-items: center; justify-content: center; font-size: 24px; position: relative; overflow: hidden; }
.photo-thumb img { width: 100%; height: 100%; object-fit: cover; }
.photo-thumb .x { position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; border-radius: 50%; background: var(--ink); color: #fff; font-size: 11px; display: flex; align-items: center; justify-content: center; cursor: pointer; border: none; }
.publish-bar { position: absolute; left: 0; right: 0; bottom: 0; background: var(--paper); border-top: 1.5px dashed var(--line); padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); }
.publish-btn { width: 100%; background: var(--yellow); color: var(--ink); border: none; padding: 15px; border-radius: 14px; font-weight: 700; font-size: 14.5px; cursor: pointer; font-family: inherit; }
.publish-btn:disabled { opacity: 0.45; cursor: not-allowed; }

/* ---------- ACCOUNT SCREEN ---------- */
.account-scroll { flex: 1; overflow-y: auto; padding: 18px 16px 100px; }
.account-you {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  font-size: 13px; color: var(--ink-soft); padding: 0 0 16px; border-bottom: 1.5px dashed var(--line); margin-bottom: 4px;
}
.chip.danger { background: #fbe8e8; border-color: #f0bcbc; color: var(--red); }
.my-listing-card {
  background: #fff; border: 1.5px solid var(--line); border-radius: var(--radius);
  padding: 12px; margin-bottom: 12px; position: relative;
}
.status-badge {
  display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.4px; padding: 3px 8px; border-radius: 5px; margin-bottom: 7px;
}
.status-badge.pending { background: #f6e5b8; color: #7a5b13; }
.status-badge.approved { background: #d9ecdb; color: #2f5136; }
.status-badge.rejected { background: #f6d6d6; color: #8a2a2a; }
.my-listing-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.featured-status { font-size: 12px; font-weight: 700; color: var(--yellow-deep); margin: 4px 0 0; }
.chip.featured-chip { background: var(--yellow); border-color: var(--yellow-deep); color: var(--ink); }
.chip.featured-chip:disabled { opacity: 0.6; cursor: not-allowed; }

/* ---------- ADS (mixed into Browse) ---------- */
.card.ad-card { background: #FFF7E0; border: 1.5px dashed var(--yellow-deep); border-left: 6px solid var(--yellow-deep); }
.ad-badge { font-size: 9.5px; font-weight: 800; letter-spacing: 0.6px; text-transform: uppercase; background: var(--yellow-deep); color: #fff; padding: 3px 7px; border-radius: 5px; }
.ad-sponsor { font-size: 11.5px; color: var(--ink-soft); margin: 0 0 6px; }

/* A code-snippet ad (e.g. a Google Ad Manager/AdSense tag) -- no thumb/link
   layout since the network's own embed renders whatever it wants. Still
   framed like the other cards so it doesn't look broken in the feed. */
.card.ad-card-snippet { display: block; cursor: default; }
.ad-badge-snippet { display: inline-block; margin-bottom: 8px; }
.ad-snippet { min-height: 40px; overflow: hidden; }

/* ---------- NEIGHBORHOOD SALES ---------- */
.neighborhood-toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--ink); cursor: pointer; }
.neighborhood-toggle input { width: 17px; height: 17px; accent-color: var(--yellow-deep); cursor: pointer; }
.neighborhood-badge {
  display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 700;
  color: var(--ink-soft); background: var(--tan); border: 1px solid var(--line);
  padding: 3px 7px; border-radius: 5px; cursor: pointer; margin-top: 7px; font-family: inherit;
}
.neighborhood-badge:hover { background: var(--yellow); border-color: var(--yellow-deep); color: var(--ink); }

/* ---------- FACEBOOK SHARE ---------- */
.fb-share-btn {
  background: #1877F2; color: #fff; border: none; padding: 13px 16px; border-radius: 12px;
  font-weight: 700; font-size: 13.5px; cursor: pointer; font-family: inherit; width: 100%;
  display: flex; align-items: center; justify-content: center; gap: 8px;
}
.fb-share-btn:hover { background: #1567d3; }

/* ---------- POST SUCCESS / SHARE PANEL ---------- */
.share-success { display: flex; flex-direction: column; align-items: center; text-align: center; padding-top: 50px; }
.share-success-icon { font-size: 46px; margin-bottom: 14px; }
.share-success-title { font-size: 17px; margin-bottom: 8px; }
.share-success-hint { margin-bottom: 22px; max-width: 280px; }
.share-success-actions { width: 100%; max-width: 300px; display: flex; flex-direction: column; gap: 10px; }

/* ---------- LISTING SHARE PAGE (/listing/[id]) ---------- */
.share-page { width: 100%; max-width: 480px; padding: 24px 16px; }
.share-card { background: #fff; border-radius: 18px; overflow: hidden; border: 1.5px solid var(--line); box-shadow: 0 20px 50px rgba(0,0,0,0.35); }
.share-logo { padding: 16px 18px 0; font-size: 19px; color: var(--yellow-deep); }
.share-logo span { color: var(--ink); }
.share-cover { width: 100%; height: 220px; object-fit: cover; display: block; margin-top: 12px; }
.share-body { padding: 18px 20px 22px; }
.share-title { font-family: inherit; font-weight: 700; font-size: 19px; margin: 0 0 8px; }
.share-addr { font-size: 13px; color: var(--ink-soft); margin: 0 0 8px; }
.share-meta { margin: 0 0 4px; }
.share-desc { font-size: 13.5px; line-height: 1.5; color: var(--ink); margin: 14px 0 0; white-space: pre-wrap; }
.share-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
.share-home-link { text-align: center; }
.share-empty { padding: 40px 24px; text-align: center; color: var(--ink-soft); font-size: 13.5px; }
.share-empty .big { font-size: 38px; margin-bottom: 12px; }
.share-home-btn { display: inline-block; text-decoration: none; margin-top: 16px; width: auto; padding: 12px 22px; }

/* ---------- TOAST ---------- */
.toast {
  position: absolute; top: 16px; left: 16px; right: 16px;
  background: var(--ink); color: var(--paper); padding: 13px 16px; border-radius: 12px;
  font-size: 13px; display: flex; align-items: center; gap: 8px;
  transform: translateY(-80px); opacity: 0; transition: all .3s ease; z-index: 1000;
  border-left: 5px solid var(--green); pointer-events: none;
}
.toast.show { transform: translateY(0); opacity: 1; }
'@ | Set-Content -Encoding UTF8 "app\globals.css"

Write-Host "Writing app\admin\page.js ..." -ForegroundColor Cyan
@'
'use client';

import { useEffect, useState } from 'react';
import styles from './admin.module.css';
import ListingForm from '@/components/ListingForm';
import AdForm from '@/components/AdForm';
import { formatDateRange } from '@/lib/format';

const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected'];

export default function AdminPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [message, setMessage] = useState(null);

  // "addListing" | "addAd" | null -- only one creation panel open at a time.
  const [activePanel, setActivePanel] = useState(null);

  const [ads, setAds] = useState([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsError, setAdsError] = useState(null);
  const [editingAdId, setEditingAdId] = useState(null);
  const [editAdDraft, setEditAdDraft] = useState(null);

  const [tags, setTags] = useState([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsError, setTagsError] = useState(null);
  const [newTagName, setNewTagName] = useState('');
  const [addingTag, setAddingTag] = useState(false);

  useEffect(() => {
    loadSales();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (authed) {
      loadAds();
      loadTags();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  async function loadSales() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/sales');
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load listings.');
      setSales(data);
      setAuthed(true);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setAuthChecked(true);
      setLoading(false);
    }
  }

  async function loadAds() {
    setAdsLoading(true);
    setAdsError(null);
    try {
      const res = await fetch('/api/admin/ads');
      if (res.status === 401) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load ads.');
      setAds(data);
    } catch (err) {
      setAdsError(err.message);
    } finally {
      setAdsLoading(false);
    }
  }

  // ---------- Tags ----------
  async function loadTags() {
    setTagsLoading(true);
    setTagsError(null);
    try {
      const res = await fetch('/api/admin/tags');
      if (res.status === 401) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load tags.');
      setTags(data);
    } catch (err) {
      setTagsError(err.message);
    } finally {
      setTagsLoading(false);
    }
  }

  async function handleAddTag(e) {
    e.preventDefault();
    if (!newTagName.trim()) return;
    setAddingTag(true);
    setTagsError(null);
    try {
      const res = await fetch('/api/admin/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTagName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add tag.');
      setTags((list) => [...list, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewTagName('');
    } catch (err) {
      setTagsError(err.message);
    } finally {
      setAddingTag(false);
    }
  }

  async function handleDeleteTag(tag) {
    if (!window.confirm(`Remove the "${tag.name}" tag? Existing listings keep it -- this only affects the picker going forward.`)) return;
    try {
      const res = await fetch(`/api/admin/tags/${tag.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete tag.');
      setTags((list) => list.filter((t) => t.id !== tag.id));
    } catch (err) {
      setTagsError(err.message);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError(null);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Incorrect password.');
      setPassword('');
      await loadSales();
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    setAuthed(false);
    setSales([]);
    setAds([]);
    setTags([]);
  }

  async function updateSale(id, updates) {
    const res = await fetch(`/api/admin/sales/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Update failed.');
    return data;
  }

  async function handleApprove(sale) {
    try {
      const updated = await updateSale(sale.id, { status: 'approved' });
      setSales((list) => list.map((s) => (s.id === sale.id ? updated : s)));
      setMessage(`Approved "${sale.title}".`);
    } catch (err) {
      setMessage(`Couldn't approve: ${err.message}`);
    }
  }

  async function handleReject(sale) {
    try {
      const updated = await updateSale(sale.id, { status: 'rejected' });
      setSales((list) => list.map((s) => (s.id === sale.id ? updated : s)));
      setMessage(`Rejected "${sale.title}".`);
    } catch (err) {
      setMessage(`Couldn't reject: ${err.message}`);
    }
  }

  async function handleDelete(sale) {
    if (!window.confirm(`Permanently delete "${sale.title}"? This can't be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/sales/${sale.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed.');
      setSales((list) => list.filter((s) => s.id !== sale.id));
      setMessage(`Deleted "${sale.title}".`);
    } catch (err) {
      setMessage(`Couldn't delete: ${err.message}`);
    }
  }

  function startEdit(sale) {
    setEditingId(sale.id);
    setEditDraft({
      title: sale.title,
      address: sale.address,
      sale_date: sale.sale_date,
      end_date: sale.end_date || '',
      start_time: (sale.start_time || '').slice(0, 5),
      end_time: (sale.end_time || '').slice(0, 5),
      description: sale.description || '',
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
  }

  async function saveEdit(sale) {
    try {
      // "" from an empty date input means "no end date" -- send null, not
      // an empty string, since end_date is a Postgres date column.
      const updated = await updateSale(sale.id, { ...editDraft, end_date: editDraft.end_date || null });
      setSales((list) => list.map((s) => (s.id === sale.id ? updated : s)));
      setMessage(`Saved changes to "${updated.title}".`);
      cancelEdit();
    } catch (err) {
      setMessage(`Couldn't save: ${err.message}`);
    }
  }

  // ---------- Ads ----------
  async function updateAd(id, updates) {
    const res = await fetch(`/api/admin/ads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Update failed.');
    return data;
  }

  async function toggleAdActive(ad) {
    try {
      const updated = await updateAd(ad.id, { active: !ad.active });
      setAds((list) => list.map((a) => (a.id === ad.id ? updated : a)));
      setMessage(`${updated.active ? 'Activated' : 'Deactivated'} "${updated.title}".`);
    } catch (err) {
      setMessage(`Couldn't update: ${err.message}`);
    }
  }

  async function handleDeleteAd(ad) {
    if (!window.confirm(`Permanently delete the ad "${ad.title}"? This can't be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/ads/${ad.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed.');
      setAds((list) => list.filter((a) => a.id !== ad.id));
      setMessage(`Deleted ad "${ad.title}".`);
    } catch (err) {
      setMessage(`Couldn't delete: ${err.message}`);
    }
  }

  function startEditAd(ad) {
    setEditingAdId(ad.id);
    setEditAdDraft({
      title: ad.title,
      description: ad.description || '',
      link_url: ad.link_url || '',
      sponsor_name: ad.sponsor_name || '',
      html_snippet: ad.html_snippet || '',
    });
  }

  function cancelEditAd() {
    setEditingAdId(null);
    setEditAdDraft(null);
  }

  async function saveEditAd(ad) {
    try {
      const updated = await updateAd(ad.id, editAdDraft);
      setAds((list) => list.map((a) => (a.id === ad.id ? updated : a)));
      setMessage(`Saved changes to "${updated.title}".`);
      cancelEditAd();
    } catch (err) {
      setMessage(`Couldn't save: ${err.message}`);
    }
  }

  const filteredSales = filter === 'all' ? sales : sales.filter((s) => s.status === filter);
  const counts = STATUS_FILTERS.reduce((acc, key) => {
    acc[key] = key === 'all' ? sales.length : sales.filter((s) => s.status === key).length;
    return acc;
  }, {});

  if (!authChecked) {
    return (
      <div className={styles.wrap}>
        <p className={styles.hint}>Loading…</p>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className={styles.loginWrap}>
        <form className={styles.loginCard} onSubmit={handleLogin}>
          <h1>SaleHop Admin</h1>
          <p className={styles.hint}>Enter the admin password to manage listings.</p>
          <input
            type="password"
            className={styles.input}
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          {loginError && <p className={styles.error}>{loginError}</p>}
          <button type="submit" className={styles.button} disabled={loggingIn || !password}>
            {loggingIn ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1>SaleHop Admin</h1>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={() => setActivePanel(activePanel === 'addListing' ? null : 'addListing')}
          >
            {activePanel === 'addListing' ? 'Close' : '+ Add Listing'}
          </button>
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={() => setActivePanel(activePanel === 'addAd' ? null : 'addAd')}
          >
            {activePanel === 'addAd' ? 'Close' : '+ Add Ad'}
          </button>
          <button type="button" className={styles.linkButton} onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </header>

      {message && <div className={styles.banner}>{message}</div>}
      {loadError && <div className={styles.bannerError}>{loadError}</div>}

      {activePanel === 'addListing' && (
        <div className={styles.listingFormWrap}>
          <ListingForm
            mode="admin-create"
            onCancel={() => setActivePanel(null)}
            onDone={(msg) => {
              setActivePanel(null);
              setMessage(msg);
              loadSales();
            }}
          />
        </div>
      )}

      {activePanel === 'addAd' && (
        <AdForm
          styles={styles}
          onCancel={() => setActivePanel(null)}
          onCreated={(ad) => {
            setAds((list) => [ad, ...list]);
            setActivePanel(null);
            setMessage(`Created ad "${ad.title}".`);
          }}
        />
      )}

      <div className={styles.filters}>
        {STATUS_FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            className={`${styles.filterBtn} ${filter === key ? styles.filterBtnActive : ''}`}
            onClick={() => setFilter(key)}
          >
            {key[0].toUpperCase() + key.slice(1)} ({counts[key]})
          </button>
        ))}
        <button type="button" className={styles.linkButton} onClick={loadSales} style={{ marginLeft: 'auto' }}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className={styles.list}>
        {filteredSales.length === 0 && <p className={styles.hint}>No listings here.</p>}

        {filteredSales.map((sale) => (
          <div className={styles.row} key={sale.id}>
            {editingId === sale.id ? (
              <div className={styles.editForm}>
                <input
                  className={styles.input}
                  value={editDraft.title}
                  onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
                  placeholder="Title"
                />
                <input
                  className={styles.input}
                  value={editDraft.address}
                  onChange={(e) => setEditDraft((d) => ({ ...d, address: e.target.value }))}
                  placeholder="Address"
                />
                <div className={styles.editRow}>
                  <input
                    type="date"
                    className={styles.input}
                    value={editDraft.sale_date}
                    onChange={(e) => setEditDraft((d) => ({ ...d, sale_date: e.target.value }))}
                  />
                  <input
                    type="date"
                    className={styles.input}
                    value={editDraft.end_date}
                    min={editDraft.sale_date}
                    placeholder="End date (optional)"
                    onChange={(e) => setEditDraft((d) => ({ ...d, end_date: e.target.value }))}
                  />
                  <input
                    type="time"
                    className={styles.input}
                    value={editDraft.start_time}
                    onChange={(e) => setEditDraft((d) => ({ ...d, start_time: e.target.value }))}
                  />
                  <input
                    type="time"
                    className={styles.input}
                    value={editDraft.end_time}
                    onChange={(e) => setEditDraft((d) => ({ ...d, end_time: e.target.value }))}
                  />
                </div>
                <p className={styles.hint} style={{ marginTop: -4 }}>
                  Leave end date blank for a single-day sale.
                </p>
                <textarea
                  className={styles.textarea}
                  value={editDraft.description}
                  onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
                  placeholder="Description"
                />
                <div className={styles.actions}>
                  <button type="button" className={styles.button} onClick={() => saveEdit(sale)}>
                    Save
                  </button>
                  <button type="button" className={styles.linkButton} onClick={cancelEdit}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className={styles.rowMain}>
                  <span className={`${styles.badge} ${styles[`badge_${sale.status}`]}`}>{sale.status}</span>
                  <div>
                    <p className={styles.rowTitle}>{sale.title}</p>
                    <p className={styles.rowSub}>{sale.address}</p>
                    <p className={styles.rowSub}>
                      {formatDateRange(sale.sale_date, sale.end_date)} · {(sale.start_time || '').slice(0, 5)}–{(sale.end_time || '').slice(0, 5)}
                      {sale.is_neighborhood_sale && sale.neighborhood_name ? ` · 🏘️ ${sale.neighborhood_name}` : ''}
                      {sale.featured && sale.featured_until ? ` · ⭐ Featured until ${sale.featured_until}` : ''}
                    </p>
                  </div>
                </div>
                <div className={styles.actions}>
                  {sale.status !== 'approved' && (
                    <button type="button" className={styles.button} onClick={() => handleApprove(sale)}>
                      Approve
                    </button>
                  )}
                  {sale.status !== 'rejected' && (
                    <button type="button" className={styles.buttonSecondary} onClick={() => handleReject(sale)}>
                      Reject
                    </button>
                  )}
                  <button type="button" className={styles.linkButton} onClick={() => startEdit(sale)}>
                    Edit
                  </button>
                  <button type="button" className={styles.linkButtonDanger} onClick={() => handleDelete(sale)}>
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <h2 className={styles.sectionHeading}>Ads</h2>

      {adsError && <div className={styles.bannerError}>{adsError}</div>}
      {adsLoading && <p className={styles.hint}>Loading ads…</p>}
      {!adsLoading && ads.length === 0 && (
        <p className={styles.hint}>No ads yet. Use &ldquo;+ Add Ad&rdquo; above to create one.</p>
      )}

      <div className={styles.list}>
        {ads.map((ad) => (
          <div className={styles.row} key={ad.id}>
            {editingAdId === ad.id ? (
              <div className={styles.editForm}>
                <input
                  className={styles.input}
                  value={editAdDraft.title}
                  onChange={(e) => setEditAdDraft((d) => ({ ...d, title: e.target.value }))}
                  placeholder="Title"
                />
                <textarea
                  className={styles.textarea}
                  value={editAdDraft.description}
                  onChange={(e) => setEditAdDraft((d) => ({ ...d, description: e.target.value }))}
                  placeholder="Description"
                />
                {ad.ad_type === 'snippet' ? (
                  <textarea
                    className={styles.codeTextarea}
                    value={editAdDraft.html_snippet}
                    onChange={(e) => setEditAdDraft((d) => ({ ...d, html_snippet: e.target.value }))}
                    placeholder="Embed code"
                    spellCheck={false}
                  />
                ) : (
                  <>
                    <input
                      className={styles.input}
                      value={editAdDraft.link_url}
                      onChange={(e) => setEditAdDraft((d) => ({ ...d, link_url: e.target.value }))}
                      placeholder="Link URL"
                    />
                    <input
                      className={styles.input}
                      value={editAdDraft.sponsor_name}
                      onChange={(e) => setEditAdDraft((d) => ({ ...d, sponsor_name: e.target.value }))}
                      placeholder="Sponsor name"
                    />
                  </>
                )}
                <div className={styles.actions}>
                  <button type="button" className={styles.button} onClick={() => saveEditAd(ad)}>
                    Save
                  </button>
                  <button type="button" className={styles.linkButton} onClick={cancelEditAd}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className={styles.rowMain}>
                  <span className={`${styles.badge} ${ad.active ? styles.badge_approved : styles.badge_rejected}`}>
                    {ad.active ? 'active' : 'inactive'}
                  </span>
                  <div>
                    <p className={styles.rowTitle}>{ad.title}</p>
                    <p className={styles.rowSub}>
                      {ad.ad_type === 'snippet'
                        ? '</> Code Snippet'
                        : ad.sponsor_name
                        ? `Sponsored by ${ad.sponsor_name}`
                        : ad.link_url}
                    </p>
                  </div>
                </div>
                <div className={styles.actions}>
                  <button type="button" className={styles.button} onClick={() => toggleAdActive(ad)}>
                    {ad.active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button type="button" className={styles.linkButton} onClick={() => startEditAd(ad)}>
                    Edit
                  </button>
                  <button type="button" className={styles.linkButtonDanger} onClick={() => handleDeleteAd(ad)}>
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <h2 className={styles.sectionHeading}>Listing Tags</h2>
      <p className={styles.hint}>
        These are the category chips (Tools, Clothing, and so on) sellers can pick from when posting a sale.
        Deleting a tag here only removes it from the picker going forward -- it won&apos;t change any listings
        that already have it.
      </p>

      {tagsError && <div className={styles.bannerError}>{tagsError}</div>}
      {tagsLoading && <p className={styles.hint}>Loading tags…</p>}

      <form className={styles.tagAddRow} onSubmit={handleAddTag}>
        <input
          className={styles.input}
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          placeholder="New tag name (e.g. Tools)"
        />
        <button type="submit" className={styles.button} disabled={addingTag || !newTagName.trim()}>
          {addingTag ? 'Adding…' : '+ Add Tag'}
        </button>
      </form>

      {!tagsLoading && tags.length === 0 && <p className={styles.hint}>No tags yet.</p>}

      <div className={styles.tagList}>
        {tags.map((tag) => (
          <span key={tag.id} className={styles.tagChip}>
            {tag.name}
            <button
              type="button"
              className={styles.tagChipRemove}
              onClick={() => handleDeleteTag(tag)}
              aria-label={`Remove ${tag.name}`}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
'@ | Set-Content -Encoding UTF8 "app\admin\page.js"

Write-Host "Staging, committing, and pushing ..." -ForegroundColor Cyan
git add .
git commit -m "Add paid Featured listings via Stripe Checkout (with review-skip on pay)"

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "If that failed with 'Please tell me who you are', run these two lines (with your info) then re-run this script:" -ForegroundColor Yellow
    Write-Host '  git config --global user.email "you@example.com"' -ForegroundColor Yellow
    Write-Host '  git config --global user.name "Your Name"' -ForegroundColor Yellow
    exit 1
}

git push

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Done! Read the setup notes I sent alongside this script -- there are a few one-time steps in the Stripe and Vercel dashboards that only a human can do, and payments won't work until those are done too." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "The push didn't finish cleanly -- scroll up for git's error message and send it to me." -ForegroundColor Red
}
