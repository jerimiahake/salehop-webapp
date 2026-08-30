'use client';

import { useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';

// Where the "sign-in link" email now lands (see emailRedirectTo in
// components/AccountScreen.js's handleSendLink), instead of dropping
// someone straight into the full mobile app UI. Many mail apps -- Yahoo
// Mail notably -- open email links in their own separate, sandboxed
// built-in browser rather than the visitor's actual browser, so the tap
// often ends up in a second, disposable tab/app anyway. This page's job
// is just to confirm the sign-in worked and say it's safe to close --
// the real SaleHop tab picks up the new session on its own (Supabase's
// client already syncs sign-in state across same-browser tabs, and
// AppShell double-checks whenever that tab becomes visible again as a
// backup), so there's nothing else for this page to do.
export default function AuthCallbackPage() {
  const [status, setStatus] = useState('checking'); // 'checking' | 'signed-in' | 'error'

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setStatus('error');
      return undefined;
    }
    let cancelled = false;

    // detectSessionInUrl (on by default) already parses the link's token
    // and establishes the session before this typically even runs -- this
    // getSession() call plus the onAuthStateChange listener below just
    // cover the timing either way.
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) setStatus('signed-in');
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === 'SIGNED_IN' && session) setStatus('signed-in');
    });

    // If nothing confirms a session within a few seconds, the link was
    // most likely already used or has expired.
    const timeout = setTimeout(() => {
      if (!cancelled) setStatus((s) => (s === 'checking' ? 'error' : s));
    }, 6000);

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  return (
    <div className="share-page">
      <div className="share-card">
        <div className="share-logo marker-font">
          Sale<span>Hop</span>
        </div>

        <div className="share-empty">
          {status === 'checking' && (
            <>
              <div className="big">⏳</div>
              <p>Signing you in…</p>
            </>
          )}

          {status === 'signed-in' && (
            <>
              <div className="big">✅</div>
              <p>
                You&apos;re signed in! Head back to the SaleHop tab you started from — it should already show you as
                signed in. You can close this one.
              </p>
              <a className="publish-btn share-home-btn" href="/">
                Or Continue Here →
              </a>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="big">⚠️</div>
              <p>This link may have expired or already been used. Go back and request a new one.</p>
              <a className="publish-btn share-home-btn" href="/">
                Back to SaleHop →
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
