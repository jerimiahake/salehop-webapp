'use client';

import { useState } from 'react';

// Public "need help?" form, linked from Your Account and from the Post
// success screen. Always saves to the database on the server side (see
// app/api/contact/route.js) even if the email notification to admin
// fails, so a message is never silently lost -- Jerimiah can also just
// check /admin's Support section.
export default function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim() || !message.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), message: message.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong sending your message.');
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="share-page">
      <div className="share-card">
        <div className="share-logo marker-font">
          Sale<span>Hop</span>
        </div>

        <div className="share-body">
          <h1 className="share-title">Need Help?</h1>

          {sent ? (
            <div className="empty-state">
              <div className="big">📬</div>
              Thanks — your message was sent. We&apos;ll get back to you as soon as we can.
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <p className="hint" style={{ marginBottom: 14 }}>
                Running into trouble posting a sale, signing in, or anything else on SaleHop? Send us a note below.
              </p>

              <div className="field-group">
                <p className="field-label">Your Name (optional)</p>
                <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>

              <div className="field-group">
                <p className="field-label">Email</p>
                <input
                  className="text-input"
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="field-group">
                <p className="field-label">Message</p>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} required />
              </div>

              {error && <p className="error-hint">{error}</p>}

              <button
                type="submit"
                className="publish-btn"
                disabled={submitting || !email.trim() || !message.trim()}
              >
                {submitting ? 'Sending…' : 'Send Message →'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
