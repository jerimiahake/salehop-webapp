'use client';

import { useState } from 'react';

// A short, one-time welcome carousel shown to first-time visitors --
// explains the two halves of the app (buyer: browse/map/route; seller:
// post/sign) in a few taps before they land on Browse. Dismissed once and
// never shown again automatically (see AppShell.js's `salehop:onboardingSeen`
// localStorage flag); reachable again anytime via the "❓ What is SaleHop?"
// link on the Account screen, which calls the same onDismiss=false path
// (see AppShell.js's handleShowWelcome).
const SLIDES = [
  {
    emoji: '🔍',
    title: 'Find Real Sales Near You',
    body: "Browse garage and yard sales happening today, see photos and details, and pull up a map of what's nearby.",
  },
  {
    emoji: '⭐',
    title: 'Favorite to Build a Route',
    body: 'Star the sales you want to hit and get one-tap driving directions to all of them in order -- no more juggling addresses.',
  },
  {
    emoji: '📝',
    title: 'Post Your Own Sale -- Free',
    body: 'List your garage sale in a couple minutes. It goes live after a quick review, and buyers nearby will see it right away.',
  },
  {
    emoji: '🖨️',
    title: 'Print a Sign, Get the Word Out',
    body: 'Every listing can generate a matching yard sign with a QR code, plus one-tap sharing to Facebook and Nextdoor.',
  },
];

export default function WelcomeOverlay({ onDismiss }) {
  const [step, setStep] = useState(0);
  const isLast = step === SLIDES.length - 1;
  const slide = SLIDES[step];

  return (
    <div className="welcome-overlay-backdrop">
      <div className="welcome-overlay-card">
        <button type="button" className="welcome-overlay-skip" onClick={onDismiss}>
          Skip
        </button>

        <div className="welcome-overlay-brand">
          Sale<span>Hop</span>
        </div>
        <p className="welcome-overlay-tagline">Find It. Map It. Get It.</p>

        <div className="welcome-overlay-emoji">{slide.emoji}</div>
        <h2 className="welcome-overlay-title">{slide.title}</h2>
        <p className="welcome-overlay-body">{slide.body}</p>

        <div className="welcome-overlay-dots">
          {SLIDES.map((s, i) => (
            <span key={s.title} className={`welcome-overlay-dot ${i === step ? 'active' : ''}`} />
          ))}
        </div>

        <button
          type="button"
          className="welcome-overlay-next"
          onClick={() => (isLast ? onDismiss() : setStep((s) => s + 1))}
        >
          {isLast ? "Let's Go!" : 'Next'}
        </button>
      </div>
    </div>
  );
}
