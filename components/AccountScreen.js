'use client';

import { useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { formatTimeRange, formatDateRange, toDateKey } from '@/lib/format';
import { SITE_URL } from '@/lib/site';
import ListingForm from './ListingForm';
import ShareToFacebookButton from './ShareToFacebookButton';

const STATUS_LABEL = { pending: 'Pending Review', approved: 'Live', rejected: 'Not Approved' };

export default function AccountScreen({
  session,
  showToast,
  onEditingChange,
  passwordRecovery,
  onPasswordRecoveryDone,
  onOpenSale,
  // Listings + editing/featuring/deleting all live in AppShell now, not
  // here -- the same "manage this listing" actions also need to work from
  // the Map screen's sheet (see the manage menu in AppShell.js), so the
  // data and the mutations that touch it live one level up and get shared
  // by both places instead of being duplicated.
  listings = [],
  listingsLoading = false,
  listingsLoadError = null,
  editingSale,
  onEditSale,
  onCancelEdit,
  onEditDone,
  onDeleteSale,
  onFeatureSale,
  featuringId,
}) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [authError, setAuthError] = useState(null);

  // Password sign-in is the default tab on the signed-out screen (see
  // "Sign In" below) -- typing a password never leaves this tab, unlike
  // the email link, which some mail apps (Yahoo Mail's built-in browser,
  // notably) hijack into their own separate browser instead of handing it
  // to the visitor's real browser, leaving them signed in over there
  // instead of back in the tab they started from.
  const [authMode, setAuthMode] = useState('password'); // 'password' | 'link'
  const [pwEmail, setPwEmail] = useState('');
  const [pwPassword, setPwPassword] = useState('');
  const [pwSigningIn, setPwSigningIn] = useState(false);
  const [pwError, setPwError] = useState(null);

  const [resetMode, setResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSending, setResetSending] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState(null);

  // "Set a password" nudge shown to a signed-in seller who got in via the
  // email link and hasn't set one yet -- see the has_password check below.
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [settingPassword, setSettingPassword] = useState(false);
  const [passwordSetError, setPasswordSetError] = useState(null);

  // Shown instead of the normal signed-in view when Supabase reports a
  // PASSWORD_RECOVERY auth event (the visitor clicked a "reset your
  // password" email link) -- see the passwordRecovery prop, set by
  // AppShell's onAuthStateChange listener.
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryConfirm, setRecoveryConfirm] = useState('');
  const [recoverySaving, setRecoverySaving] = useState(false);
  const [recoveryError, setRecoveryError] = useState(null);

  // Let AppShell know whether we're mid-edit, so it can hide the bottom nav
  // the same way it does during Post -- tapping away mid-edit would
  // otherwise silently discard unsaved changes.
  useEffect(() => {
    onEditingChange?.(Boolean(editingSale));
    return () => onEditingChange?.(false);
  }, [editingSale, onEditingChange]);

  async function handleSendLink() {
    if (!email.trim()) return;
    setSending(true);
    setAuthError(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          // Lands on the lightweight "you're signed in" splash
          // (app/auth/callback/page.js) instead of dropping the visitor
          // straight into the full app UI in what's often a second,
          // disposable tab/mail-app browser.
          emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined,
        },
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      const msg = err.message || 'Something went wrong sending your link.';
      setAuthError(msg);
      // Best-effort: lets Jerimiah see in /admin that a signup failed, even
      // though the visitor never tells him directly. Never lets a logging
      // hiccup surface as a second error on top of the real one above.
      fetch('/api/log-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'signup', message: msg, email: email.trim() }),
      }).catch(() => {});
    } finally {
      setSending(false);
    }
  }

  async function handlePasswordSignIn() {
    if (!pwEmail.trim() || !pwPassword) return;
    setPwSigningIn(true);
    setPwError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: pwEmail.trim(),
        password: pwPassword,
      });
      if (error) throw error;
    } catch (err) {
      // Supabase returns the same generic error whether the password is
      // wrong or was simply never set -- can't tell those apart here, so
      // the message covers both without guessing which one it is.
      const msg =
        "That email and password didn't match. If you haven't set a password yet, use \"Email Link\" below to sign in, then set one from your Account.";
      setPwError(msg);
      fetch('/api/log-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'signup', message: err.message || 'Password sign-in failed', email: pwEmail.trim() }),
      }).catch(() => {});
    } finally {
      setPwSigningIn(false);
    }
  }

  async function handleForgotPassword() {
    if (!resetEmail.trim()) return;
    setResetSending(true);
    setResetError(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
        redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      });
      if (error) throw error;
      setResetSent(true);
    } catch (err) {
      setResetError(err.message || 'Something went wrong sending your reset link.');
    } finally {
      setResetSending(false);
    }
  }

  async function handleSetPassword() {
    if (newPassword.length < 8) {
      setPasswordSetError('Use at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordSetError("Those passwords don't match.");
      return;
    }
    setSettingPassword(true);
    setPasswordSetError(null);
    try {
      // has_password rides along in user_metadata rather than a new
      // database table/column -- it's the flag the "set a password" nudge
      // below checks to know whether to keep showing itself.
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
        data: { has_password: true },
      });
      if (error) throw error;
      setNewPassword('');
      setConfirmPassword('');
      showToast?.('Password set — you can sign in with it next time, or keep using the email link.');
    } catch (err) {
      setPasswordSetError(err.message || 'Could not set a password.');
    } finally {
      setSettingPassword(false);
    }
  }

  async function handleSaveRecoveryPassword() {
    if (recoveryPassword.length < 8) {
      setRecoveryError('Use at least 8 characters.');
      return;
    }
    if (recoveryPassword !== recoveryConfirm) {
      setRecoveryError("Those passwords don't match.");
      return;
    }
    setRecoverySaving(true);
    setRecoveryError(null);
    try {
      const { error } = await supabase.auth.updateUser({
        password: recoveryPassword,
        data: { has_password: true },
      });
      if (error) throw error;
      showToast?.('New password saved — you can use it to sign in from now on.');
      onPasswordRecoveryDone?.();
    } catch (err) {
      setRecoveryError(err.message || 'Could not save your new password.');
    } finally {
      setRecoverySaving(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setSent(false);
    setEmail('');
  }

  // Delete/Feature/Edit for a listing all live in AppShell now (onDeleteSale
  // / onFeatureSale / onEditSale props) so the same "manage this listing"
  // actions also work from the Map screen's manage menu, not just here.

  // ---------- Password recovery: clicked a "reset password" email link ----------
  if (session && passwordRecovery) {
    return (
      <>
        <div className="header" style={{ borderBottomColor: 'var(--yellow)' }}>
          <div className="header-row">
            <div className="logo marker-font" style={{ fontSize: 17 }}>
              New <span>Password</span>
            </div>
          </div>
        </div>

        <div className="account-scroll">
          <div className="field-group">
            <p className="field-label">Choose a new password</p>
            <p className="hint" style={{ marginBottom: 12 }}>
              You clicked a password reset link — set your new password below.
            </p>
            <input
              className="text-input"
              type="password"
              placeholder="New password"
              value={recoveryPassword}
              onChange={(e) => setRecoveryPassword(e.target.value)}
            />
            <input
              className="text-input"
              type="password"
              placeholder="Confirm new password"
              value={recoveryConfirm}
              onChange={(e) => setRecoveryConfirm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveRecoveryPassword()}
              style={{ marginTop: 8 }}
            />
            {recoveryError && <p className="error-hint">{recoveryError}</p>}
            <button
              type="button"
              className="publish-btn"
              style={{ width: 'auto', display: 'inline-block', marginTop: 12, padding: '12px 22px' }}
              disabled={recoverySaving || !recoveryPassword || !recoveryConfirm}
              onClick={handleSaveRecoveryPassword}
            >
              {recoverySaving ? 'Saving…' : 'Save New Password'}
            </button>
          </div>
        </div>
      </>
    );
  }

  // ---------- Editing an existing listing ----------
  if (session && editingSale) {
    return (
      <ListingForm
        mode="edit"
        session={session}
        initialSale={editingSale}
        onCancel={() => onCancelEdit?.()}
        onDone={onEditDone}
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

            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button
                type="button"
                className={`chip ${authMode === 'password' ? 'on' : ''}`}
                onClick={() => setAuthMode('password')}
              >
                Password
              </button>
              <button
                type="button"
                className={`chip ${authMode === 'link' ? 'on' : ''}`}
                onClick={() => setAuthMode('link')}
              >
                Email Link
              </button>
            </div>

            {authMode === 'password' ? (
              resetMode ? (
                // ---------- Forgot password ----------
                resetSent ? (
                  <div className="empty-state">
                    <div className="big">📬</div>
                    Check <b>{resetEmail}</b> for a link to set a new password, then come back to this tab.
                    <div style={{ marginTop: 14 }}>
                      <button
                        type="button"
                        className="chip"
                        onClick={() => {
                          setResetMode(false);
                          setResetSent(false);
                        }}
                      >
                        Back to Sign In
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="hint" style={{ marginBottom: 12 }}>
                      Enter your email and we&apos;ll send you a link to set a new password. (This part still has to
                      go through email — but it&apos;s only needed the rare time you forget one.)
                    </p>
                    <input
                      className="text-input"
                      type="email"
                      inputMode="email"
                      placeholder="you@example.com"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleForgotPassword()}
                    />
                    {resetError && <p className="error-hint">{resetError}</p>}
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
                      <button
                        type="button"
                        className="publish-btn"
                        style={{ width: 'auto', display: 'inline-block', padding: '12px 22px' }}
                        disabled={resetSending || !resetEmail.trim()}
                        onClick={handleForgotPassword}
                      >
                        {resetSending ? 'Sending…' : 'Send Reset Link →'}
                      </button>
                      <button type="button" className="chip" onClick={() => setResetMode(false)}>
                        Cancel
                      </button>
                    </div>
                  </>
                )
              ) : (
                // ---------- Password sign-in ----------
                <>
                  <p className="hint" style={{ marginBottom: 12 }}>
                    Sign in with your email and password — nothing to click in your email app.
                  </p>
                  <input
                    className="text-input"
                    type="email"
                    inputMode="email"
                    placeholder="you@example.com"
                    value={pwEmail}
                    onChange={(e) => setPwEmail(e.target.value)}
                  />
                  <input
                    className="text-input"
                    type="password"
                    placeholder="Password"
                    value={pwPassword}
                    onChange={(e) => setPwPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handlePasswordSignIn()}
                    style={{ marginTop: 8 }}
                  />
                  {pwError && <p className="error-hint">{pwError}</p>}
                  <button
                    type="button"
                    className="publish-btn"
                    style={{ width: 'auto', display: 'inline-block', marginTop: 12, padding: '12px 22px' }}
                    disabled={pwSigningIn || !pwEmail.trim() || !pwPassword}
                    onClick={handlePasswordSignIn}
                  >
                    {pwSigningIn ? 'Signing in…' : 'Sign In →'}
                  </button>
                  <div style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className="hint"
                      style={{ background: 'none', border: 'none', textDecoration: 'underline', padding: 0, cursor: 'pointer' }}
                      onClick={() => {
                        setResetMode(true);
                        setResetEmail(pwEmail);
                      }}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <p className="hint" style={{ marginTop: 14 }}>
                    New here, or haven&apos;t set a password yet?{' '}
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', textDecoration: 'underline', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit' }}
                      onClick={() => setAuthMode('link')}
                    >
                      Use the email link instead
                    </button>
                    .
                  </p>
                </>
              )
            ) : sent ? (
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
                <p className="hint" style={{ marginBottom: 12 }}>
                  Enter your email and we&apos;ll send you a one-click sign-in link — no password to remember. (Heads
                  up: some mail apps open this link in their own built-in browser instead of your regular one — if
                  that happens and things look off, set a password instead once you&apos;re in.)
                </p>
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
                <p className="hint" style={{ marginTop: 14 }}>
                  Already set a password?{' '}
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', textDecoration: 'underline', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit' }}
                    onClick={() => setAuthMode('password')}
                  >
                    Sign in with it instead
                  </button>
                  .
                </p>
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

        {!session.user.user_metadata?.has_password && (
          <div className="field-group" style={{ marginTop: 14 }}>
            <p className="field-label">🔒 Set a Password</p>
            <p className="hint" style={{ marginBottom: 12 }}>
              Sign in faster next time without waiting on an email link — set a password now, or skip this and keep
              using the link.
            </p>
            <input
              className="text-input"
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <input
              className="text-input"
              type="password"
              placeholder="Confirm password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSetPassword()}
              style={{ marginTop: 8 }}
            />
            {passwordSetError && <p className="error-hint">{passwordSetError}</p>}
            <button
              type="button"
              className="publish-btn"
              style={{ width: 'auto', display: 'inline-block', marginTop: 12, padding: '12px 22px' }}
              disabled={settingPassword || !newPassword || !confirmPassword}
              onClick={handleSetPassword}
            >
              {settingPassword ? 'Saving…' : 'Save Password'}
            </button>
          </div>
        )}

        <div className="sidebar-label" style={{ marginTop: 18 }}>My Listings</div>

        {listingsLoading && <div className="empty-state">Loading your listings…</div>}

        {!listingsLoading && listingsLoadError && (
          <div className="empty-state">
            <div className="big">⚠️</div>
            Couldn&apos;t load your listings right now.
            <br />
            {listingsLoadError}
          </div>
        )}

        {!listingsLoading && !listingsLoadError && listings.length === 0 && (
          <div className="empty-state">
            <div className="big">📋</div>
            You haven&apos;t posted any sales yet. Tap Post below to get started.
          </div>
        )}

        {!listingsLoading &&
          !listingsLoadError &&
          listings.map((sale) => {
            const isCurrentlyFeatured = Boolean(
              sale.featured && sale.featured_until && sale.featured_until >= toDateKey(new Date())
            );
            const canPreview = sale.status === 'approved';
            return (
              <div
                className={`my-listing-card ${isCurrentlyFeatured ? 'featured' : ''} ${canPreview ? 'clickable' : ''}`}
                key={sale.id}
                onClick={() => {
                  if (canPreview) {
                    onOpenSale?.(sale.id);
                  } else {
                    showToast?.("This listing isn't live yet, so there's no public page to preview -- it'll be viewable here once it's approved.");
                  }
                }}
              >
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
                <div className="my-listing-actions" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="chip" onClick={() => onEditSale?.(sale)}>
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
                  {sale.status === 'approved' && (
                    <a
                      className="chip"
                      href={`/listing/${sale.id}/sign`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      🖨️ Print Sign
                    </a>
                  )}
                  {sale.status !== 'rejected' && (
                    <button
                      type="button"
                      className="chip featured-chip"
                      disabled={featuringId === sale.id || isCurrentlyFeatured}
                      onClick={() => onFeatureSale?.(sale)}
                    >
                      {isCurrentlyFeatured
                        ? '✓ Currently Featured'
                        : featuringId === sale.id
                        ? 'Starting checkout…'
                        : sale.status === 'pending'
                        ? '⭐ Skip Wait & Feature — $10'
                        : '⭐ Feature — $10'}
                    </button>
                  )}
                  <button type="button" className="chip danger" onClick={() => onDeleteSale?.(sale)}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}

        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <a className="hint" href="/contact" style={{ textDecoration: 'underline' }}>
            Need help? Contact us
          </a>
        </div>
      </div>
    </>
  );
}
