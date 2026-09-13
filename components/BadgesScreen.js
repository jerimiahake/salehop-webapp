'use client';

import { useEffect, useMemo, useState } from 'react';
import { getOrCreateDeviceId } from '@/lib/deviceId';
import { BADGES, BADGE_CATEGORIES, getEarnedBadgeIds } from '@/lib/badges';

// Full-screen "🏅 Badges" view, reached from a card on AccountScreen.js.
// Two halves: your own badge grid (locked + unlocked, merging the
// anonymous device-based Scout/Explorer/Community counts from
// /api/players/me with Seller badges computed live from the `listings`
// prop AppShell.js already loads -- no separate tracking needed for
// those, a seller's real listing count IS the badge count) and the
// public leaderboard from /api/leaderboard underneath it, Foursquare-
// style. A visitor without a username yet can set one right here, which
// is also what actually puts them on that leaderboard.
export default function BadgesScreen({ onClose, listings = [], showToast }) {
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({});
  const [player, setPlayer] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [usernameDraft, setUsernameDraft] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const deviceId = getOrCreateDeviceId();

    Promise.all([
      fetch(`/api/players/me?deviceId=${encodeURIComponent(deviceId)}`).then((r) => r.json()),
      fetch('/api/leaderboard').then((r) => r.json()),
    ])
      .then(([me, board]) => {
        if (cancelled) return;
        setCounts(me.counts || {});
        setPlayer(me.player || null);
        setLeaderboard(Array.isArray(board) ? board : []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Seller badges reuse the same real listings a seller can already see
  // under "My Listings" -- no separate activity log, so there's nothing
  // to fall out of sync.
  const context = useMemo(
    () => ({
      ...counts,
      salesPostedCount: listings.length,
      hasNeighborhoodSale: listings.some((s) => s.is_neighborhood_sale),
    }),
    [counts, listings]
  );

  const earnedIds = useMemo(() => new Set(getEarnedBadgeIds(context)), [context]);

  async function handleSaveUsername(e) {
    e.preventDefault();
    if (!usernameDraft.trim()) return;
    setSavingUsername(true);
    setUsernameError(null);
    try {
      const res = await fetch('/api/players/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: getOrCreateDeviceId(), username: usernameDraft.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save that.');
      setPlayer(data);
      setUsernameDraft('');
      showToast?.('✅ Username saved -- you’re on the leaderboard now.');
      fetch('/api/leaderboard')
        .then((r) => r.json())
        .then((board) => setLeaderboard(Array.isArray(board) ? board : []));
    } catch (err) {
      setUsernameError(err.message || 'Something went wrong.');
    } finally {
      setSavingUsername(false);
    }
  }

  const totalEarned = earnedIds.size;
  const myRank = player?.username
    ? leaderboard.findIndex((row) => row.username.toLowerCase() === player.username.toLowerCase()) + 1 || null
    : null;

  return (
    <>
      <div className="post-header">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div className="title">🏅 Badges</div>
      </div>

      <div className="post-scroll">
        <div style={{ textAlign: 'center', margin: '4px 0 18px' }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{loading ? '…' : totalEarned}</div>
          <div className="hint" style={{ marginTop: 2 }}>
            badge{totalEarned === 1 ? '' : 's'} earned{myRank ? ` · #${myRank} on the leaderboard` : ''}
          </div>
        </div>

        {!loading && !player?.username && (
          <form onSubmit={handleSaveUsername} className="field-group" style={{ marginBottom: 18 }}>
            <p className="field-label">Join the leaderboard</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="text-input"
                placeholder="Pick a username"
                value={usernameDraft}
                onChange={(e) => setUsernameDraft(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit" className="chip" disabled={savingUsername || !usernameDraft.trim()}>
                {savingUsername ? 'Saving…' : 'Save'}
              </button>
            </div>
            {usernameError && <p className="error-hint">{usernameError}</p>}
          </form>
        )}

        {Object.entries(BADGE_CATEGORIES).map(([catId, cat]) => (
          <div key={catId} style={{ marginBottom: 20 }}>
            <div className="sidebar-label">{cat.label}</div>
            <p className="hint" style={{ marginTop: -4, marginBottom: 10 }}>
              {cat.blurb}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 10 }}>
              {BADGES.filter((b) => b.category === catId).map((b) => {
                const earned = earnedIds.has(b.id);
                return (
                  <div
                    key={b.id}
                    title={b.description}
                    style={{
                      textAlign: 'center',
                      padding: '10px 6px',
                      borderRadius: 12,
                      border: '1.5px solid var(--line)',
                      background: earned ? '#fff' : 'var(--tan)',
                      opacity: earned ? 1 : 0.5,
                    }}
                  >
                    <div style={{ fontSize: 28, filter: earned ? 'none' : 'grayscale(1)' }}>{b.emoji}</div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 4, lineHeight: 1.25 }}>{b.name}</div>
                    {!earned && (
                      <div style={{ fontSize: 9.5, color: 'var(--ink-soft)', marginTop: 2, lineHeight: 1.25 }}>
                        {b.description}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div className="sidebar-label" style={{ marginTop: 8 }}>Leaderboard</div>
        <p className="hint" style={{ marginTop: -4, marginBottom: 10 }}>
          Only visitors who&apos;ve set a username show up here.
        </p>

        {loading && <div className="empty-state">Loading…</div>}
        {!loading && leaderboard.length === 0 && (
          <div className="empty-state">
            <div className="big">🏆</div>
            No one&apos;s on the board yet -- be the first!
          </div>
        )}

        {!loading &&
          leaderboard.map((row, i) => {
            const isMe = player?.username && row.username.toLowerCase() === player.username.toLowerCase();
            return (
              <div
                key={row.username}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: isMe ? 'var(--yellow)' : 'transparent',
                  borderBottom: isMe ? 'none' : '1px solid var(--line)',
                }}
              >
                <div style={{ fontWeight: 700, width: 22, textAlign: 'right' }}>{i + 1}</div>
                <div style={{ fontSize: 20 }}>{row.topBadgeEmoji || '🙂'}</div>
                <div style={{ flex: 1, fontWeight: isMe ? 700 : 500 }}>{row.username}</div>
                <div className="hint" style={{ margin: 0 }}>
                  {row.badgeCount} badge{row.badgeCount === 1 ? '' : 's'}
                </div>
              </div>
            );
          })}
      </div>
    </>
  );
}
