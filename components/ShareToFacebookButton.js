'use client';

// A plain-link share button -- no Facebook SDK, no app registration, no
// login required. Facebook's sharer.php endpoint just needs a public URL
// (it fetches that page's Open Graph tags itself to build the preview),
// so this works for free with zero setup and no ongoing cost.
export default function ShareToFacebookButton({ url, quote, className, label = 'Share to Facebook' }) {
  function handleShare() {
    const params = new URLSearchParams({ u: url });
    if (quote) params.set('quote', quote);
    const shareUrl = `https://www.facebook.com/sharer/sharer.php?${params.toString()}`;
    window.open(shareUrl, 'salehop-fb-share', 'width=580,height=520,noopener,noreferrer');
  }

  return (
    <button type="button" className={className || 'fb-share-btn'} onClick={handleShare}>
      📘 {label}
    </button>
  );
}
