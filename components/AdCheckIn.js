'use client';

import { useState } from 'react';
import CheckInButton from './CheckInButton';

// Wraps CheckInButton for the standalone /ad/[id] share page, which -- unlike
// the main app shell -- has no AppShell/Toast context to pass down. This
// component owns a tiny local "toast" (just a one-line status message under
// the button) instead, and shows the Mayor line (if any) passed in from the
// server-rendered page.
export default function AdCheckIn({ adId, mayor }) {
  const [status, setStatus] = useState('');

  return (
    <div style={{ marginTop: 14 }}>
      {mayor && (
        <p className="share-addr" style={{ marginBottom: 8 }}>
          👑 Mayor: {mayor.username} ({mayor.visits} visit{mayor.visits === 1 ? '' : 's'})
        </p>
      )}
      <CheckInButton
        targetType="ad"
        targetId={adId}
        onNewBadges={() => {}}
        showToast={(message) => setStatus(message)}
        className="publish-btn share-home-btn"
      />
      {status && (
        <p className="card-addr" style={{ marginTop: 6 }}>
          {status}
        </p>
      )}
    </div>
  );
}
