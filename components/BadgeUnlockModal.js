'use client';

import { useEffect, useState } from 'react';
import { getOrCreateDeviceId } from '@/lib/deviceId';

// Pops whenever AppShell.js's handleNewBadges gets a non-empty newBadges
// array back from any badge-earning API call (spotting/confirming a sale,
// contributing a photo, checking in). This is also where the app's
// progressive, no-password lead capture actually happens: the FIRST badge
// a device earns asks for an email (required to "save" it, matching how
// Jerimiah wanted this scoped -- a fun reason to hand over contact info,
// not a signup wall blocking anything). A later badge (once this device
// has racked up 3+ total) asks for a phone number too, framed as a real
// perk (text alerts) rather than "give us your number." A username is
// always offered alongside whichever of those is being asked, since
// that's what actually gets you onto the public leaderboard
// (components/BadgesScreen.js) -- entirely optional, on purpose.
//
// Skipping never loses the badge itself -- it's already recorded
// server-side the moment it was earned (see lib/badgeEngine.js). Skipping
// just means this device gets asked again next time it earns a new one.
export default function BadgeUnlockModal({ badges, onClose, showToast }) {
  const [loading, setLoading] = useState(true);
  const [player, setPlayer] = useState(null);
  const [totalBadgeCount, setTotalBadgeCount] = useState(0);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/players/me?deviceId=${encodeURIComponent(getOrCreateDeviceId())}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setPlayer(data.player || null);
        setTotalBadgeCount((data.earnedBadgeIds || []).length);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!badges || badges.length === 0) return null;

  const needsEmail = !loading && !player?.email;
  const needsPhone = !loading && !needsEmail && !player?.phone && totalBadgeCount >= 3;
  const needsUsername = !loading && !player?.username;
  const showForm = needsEmail || needsPhone;

  async function handleSave(e) {
    e.preventDefault();
    setError(null);

    if (needsEmail && !email.trim()) {
      setError('Enter your email to save this badge to your profile.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/players/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: getOrCreateDeviceId(),
          email: needsEmail ? email.trim() : undefined,
          phone: needsPhone && phone.trim() ? phone.trim() : undefined,
          username: needsUsername && username.trim() ? username.trim() : undefined,
          marketingOptIn,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save that.');
      showToast?.('🎉 Saved -- your badge is on your profile now.');
      onClose?.();
    } catch (err) {
      setError(err.message || 'Something went wrong saving that.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="manage-menu-backdrop" onClick={() => !submitting && onClose?.()}>
      <div className="manage-menu" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 340 }}>
        <div className="manage-menu-title">🎉 Badge{badges.length > 1 ? 's' : ''} Earned!</div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', margin: '4px 0 12px' }}>
          {badges.map((b) => (
            <div key={b.id} style={{ textAlign: 'center', width: 84 }}>
              <div style={{ fontSize: 32 }}>{b.emoji}</div>
              <div style={{ fontSize: 11, fontWeight: 700 }}>{b.name}</div>
            </div>
          ))}
        </div>

        {!loading && !showForm && (
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', textAlign: 'center', margin: '0 0 10px' }}>
            {badges[0].description}
          </p>
        )}

        {!loading && showForm && (
          <form onSubmit={handleSave}>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', textAlign: 'center', margin: '0 0 12px' }}>
              {needsEmail
                ? "Enter your email to save this badge to your profile -- it'll be waiting for you next time."
                : "Want a text when there's a sale near you? Add your number (totally optional)."}
            </p>

            {needsEmail && (
              <input
                className="text-input"
                type="email"
                placeholder="Your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            )}
            {needsPhone && (
              <input
                className="text-input"
                type="tel"
                placeholder="Your phone number (optional)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={{ marginTop: needsEmail ? 8 : 0 }}
              />
            )}
            {needsUsername && (
              <input
                className="text-input"
                placeholder="Pick a username (optional -- shows on the leaderboard)"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={{ marginTop: 8 }}
              />
            )}

            <label className="neighborhood-toggle" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} />
              <span>It&apos;s OK to occasionally tell me about sales/badges nearby</span>
            </label>

            {error && <p className="error-hint">{error}</p>}

            <button type="submit" className="publish-btn" style={{ marginTop: 12 }} disabled={submitting}>
              {submitting ? 'Saving…' : needsEmail ? 'Save My Badge' : 'Save'}
            </button>
          </form>
        )}

        <button type="button" className="manage-menu-cancel" onClick={() => !submitting && onClose?.()}>
          {showForm ? 'Skip for now' : 'Nice!'}
        </button>
      </div>
    </div>
  );
}
