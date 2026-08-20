'use client';

// A round icon-only share button for buyers browsing a sale (not just the
// seller who posted it) -- separate from ShareToFacebookButton, which is
// a full-width, Facebook-only button used elsewhere (right after posting,
// and in My Listings).
//
// On a touch device (phone/tablet), navigator.share() opens the OS's own
// native share sheet -- Messages, Instagram, WhatsApp, Facebook, email,
// whatever the person actually has installed, not just Facebook.
//
// On a non-touch desktop (mouse/trackpad), this skips navigator.share
// entirely and goes straight to the same Facebook popup used elsewhere in
// the app. Some desktop browsers technically expose navigator.share now,
// but calling it spends the click's "this came from a real user action"
// permission before we know whether it'll actually succeed -- if it then
// fails, the popup fallback that follows can get silently blocked by the
// browser, because by that point it no longer looks like a direct
// response to the click. Going straight to the popup on desktop sidesteps
// that failure mode rather than risking it.
export default function ShareButton({ url, title, className, label = 'Share this sale' }) {
  function isTouchDevice() {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
  }

  function openFacebookPopup() {
    const params = new URLSearchParams({ u: url });
    if (title) params.set('quote', title);
    window.open(
      `https://www.facebook.com/sharer/sharer.php?${params.toString()}`,
      'salehop-share',
      'width=580,height=520,noopener,noreferrer'
    );
  }

  async function handleShare(e) {
    e.stopPropagation();

    if (typeof navigator !== 'undefined' && navigator.share && isTouchDevice()) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return; // person cancelled the native sheet -- do nothing
        // any other error (e.g. share() unsupported for these args on this
        // browser) -- fall through to the Facebook popup below
      }
    }

    openFacebookPopup();
  }

  return (
    <button type="button" className={className || 'sheet-share'} onClick={handleShare} aria-label={label}>
      ↗
    </button>
  );
}
