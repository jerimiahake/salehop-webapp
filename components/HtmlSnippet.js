'use client';

import { useEffect, useRef } from 'react';

// Renders an arbitrary HTML/JS snippet -- e.g. a Google AdSense/Ad Manager
// embed tag pasted into the admin panel. React's dangerouslySetInnerHTML
// would insert the markup, but browsers never execute <script> tags that
// arrive that way. This works around that (the standard technique): after
// the snippet is in the DOM, it finds any <script> tags inside and
// re-creates each one as a fresh <script> element, which DOES execute.
//
// Security note: this snippet is only ever set from /admin, which is
// password-gated -- there's no path for a site visitor's input to end up
// here. Treat it the same as you'd treat pasting a WordPress "Custom HTML"
// widget: only paste snippets from sources you trust (Google, etc.),
// since whatever runs here runs with full access to the page.
export default function HtmlSnippet({ html }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !html) return;

    container.innerHTML = html;

    const scripts = Array.from(container.querySelectorAll('script'));
    scripts.forEach((oldScript) => {
      const newScript = document.createElement('script');
      Array.from(oldScript.attributes).forEach((attr) => {
        newScript.setAttribute(attr.name, attr.value);
      });
      newScript.textContent = oldScript.textContent;
      oldScript.parentNode.replaceChild(newScript, oldScript);
    });
  }, [html]);

  return <div ref={containerRef} className="ad-snippet" />;
}
