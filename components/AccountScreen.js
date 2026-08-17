'use client';

import { useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { formatTimeRange } from '@/lib/format';
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
          listings.map((sale) => (
            <div className="my-listing-card" key={sale.id}>
              <div className={`status-badge ${sale.status}`}>{STATUS_LABEL[sale.status] || sale.status}</div>
              <p className="card-title">{sale.title}</p>
              <p className="card-addr">{sale.address}</p>
              <p className="card-addr">
                {sale.sale_date} · {formatTimeRange(sale.start_time, sale.end_time)}
              </p>
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
                <button type="button" className="chip danger" onClick={() => handleDelete(sale)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
      </div>
    </>
  );
}
