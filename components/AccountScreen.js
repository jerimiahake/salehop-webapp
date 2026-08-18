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
              <div className={`my-listing-card ${isCurrentlyFeatured ? 'featured' : ''}`} key={sale.id}>
                <div className={`status-badge ${sale.status}`}>{STATUS_LABEL[sale.status] || sale.status}</div>
                {isCurrentlyFeatured && <div className="status-badge featured-pill">⭐ Featured</div>}
                <p className="card-title">{sale.title}</p>
                <p className="card-addr">{sale.address}</p>
                <p className="card-addr">
                  {formatDateRange(sale.sale_date, sale.end_date)} · {formatTimeRange(sale.start_time, sale.end_time)}
                </p>
                {isCurrentlyFeatured && (
                  <p className="featured-status">Featured until {sale.featured_until}</p>
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
