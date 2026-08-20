'use client';

// A round icon-only share button for buyers browsing a sale (not just the
// seller who posted it) -- separate from ShareToFacebookButton, which is
// a full-width, Facebook-only button used elsewhere (right after posting,
// and in My Listings).
//
// On a phone, navigator.share() opens the OS's own native share sheet --
// Messages, Instagram, WhatsApp, Facebook, email, whatever the person
// actually has installed, not just Facebook. Most desktop browsers don't
// support it, so this falls back to the same Facebook popup used
// elsewhere in the app for those cases.
export default function ShareButton({ url, title, className, label = 'Share this sale' }) {
  async function handleShare(e) {
    e.stopPropagation();

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return; // person cancelled the native sheet -- do nothing
        // any other error (e.g. share() unsupported for these args on this
        // browser) -- fall through to the Facebook popup below
      }
    }

    const params = new URLSearchParams({ u: url });
    if (title) params.set('quote', title);
    window.open(
      `https://www.facebook.com/sharer/sharer.php?${params.toString()}`,
      'salehop-share',
      'width=580,height=520,noopener,noreferrer'
    );
  }

  return (
    <button type="button" className={className || 'sheet-share'} onClick={handleShare} aria-label={label}>
      â†—
    </button>
  );
}
