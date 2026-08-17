'use client';

import ListingForm from './ListingForm';

// Posting now requires a signed-in account (so a listing can be linked to
// whoever posted it, for the "My Listings" edit/cancel screen). This
// component just gates on that -- the actual form lives in ListingForm.js,
// shared with the edit flow on the Account screen.
export default function PostScreen({ session, onCancel, onPublished, onGoToAccount }) {
  if (!session) {
    return (
      <>
        <div className="post-header">
          <button type="button" className="icon-btn" onClick={onCancel} aria-label="Cancel">
            ✕
          </button>
          <div className="title">Post a Garage Sale</div>
        </div>
        <div className="empty-state">
          <div className="big">🔒</div>
          Sign in to post a sale -- it only takes an email, no password needed.
          <div style={{ marginTop: 16 }}>
            <button
              type="button"
              className="publish-btn"
              style={{ width: 'auto', display: 'inline-block', padding: '12px 22px' }}
              onClick={onGoToAccount}
            >
              Go to Account →
            </button>
          </div>
        </div>
      </>
    );
  }

  return <ListingForm mode="create" session={session} onCancel={onCancel} onDone={onPublished} />;
}
