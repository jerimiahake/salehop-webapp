'use client';

import { useState } from 'react';
import { getOrCreateDeviceId } from '@/lib/deviceId';

// "📍 I'm here!" -- lets a visitor prove they actually showed up to a sale
// (ListingSheet.js) or a physical-location ad (app/ad/[id]/page.js),
// powering the Explorer badges and, for ads specifically, "Mayor"
// standing (lib/getAdMayor.js). Same shape as the app's other
// geolocation-gated actions (spotting/confirming a sale): grab a fresh GPS
// fix, let the server (app/api/checkins) decide if that's actually close
// enough -- there's no client-side override if it says no.
export default function CheckInButton({ targetType, targetId, onNewBadges, showToast, className }) {
  const [checking, setChecking] = useState(false);
  const [done, setDone] = useState(false);

  function handleClick() {
    if (!('geolocation' in navigator)) {
      showToast?.("Your browser doesn't support location -- can't check in from here.");
      return;
    }
    setChecking(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch('/api/checkins', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              deviceId: getOrCreateDeviceId(),
              targetType,
              targetId,
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Could not check in.');
          setDone(true);
          showToast?.(data.alreadyCheckedIn ? "You're already checked in here today." : '📍 Checked in!');
          onNewBadges?.(data.newBadges);
        } catch (err) {
          showToast?.(`Couldn't check in: ${err.message}`);
        } finally {
          setChecking(false);
        }
      },
      () => {
        showToast?.('Location access is needed to check in.');
        setChecking(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <button type="button" className={className || 'chip'} onClick={handleClick} disabled={checking || done}>
      {done ? '✅ Checked In' : checking ? 'Checking…' : "📍 I'm here!"}
    </button>
  );
}
