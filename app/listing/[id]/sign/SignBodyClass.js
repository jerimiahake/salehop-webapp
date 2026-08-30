'use client';

import { useEffect } from 'react';

// globals.css centers page content vertically inside the phone-frame body
// (align-items: center) -- fine for short, fixed-height content, but the
// sign builder's height changes a lot as you switch orientation/paper
// size, and can easily end up taller than one screen (especially the
// "Large Sign" 6-tile mode). When a flex-centered child is taller than
// its container, the excess overflows equally above AND below -- but a
// page can only ever scroll down to reach content below, never up past
// the top, so that portion above simply becomes unreachable. That's what
// was hiding the Orientation toggle (and sometimes the sign itself) after
// switching options: the content grew, and the browser centered it right
// off the top of the reachable page.
//
// Swapping in `body.sign-mode` (see globals.css) for as long as this page
// is mounted -- same pattern /admin uses via AdminBodyClass -- switches
// to a normal top-anchored, fully-scrollable layout instead, so nothing
// can ever end up above where scrolling can reach.
export default function SignBodyClass() {
  useEffect(() => {
    document.body.classList.add('sign-mode');
    return () => document.body.classList.remove('sign-mode');
  }, []);

  return null;
}
