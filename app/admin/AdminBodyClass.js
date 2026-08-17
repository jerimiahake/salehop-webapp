'use client';

import { useEffect } from 'react';

// The main site's globals.css centers everything inside a fixed-size phone
// frame (it's a mobile-first mockup). The admin dashboard is a normal
// desktop page, so this swaps in a plain full-width layout for as long as
// an /admin page is mounted (see the `body.admin-mode` rule in
// globals.css), and restores the phone-frame layout on the way out.
export default function AdminBodyClass() {
  useEffect(() => {
    document.body.classList.add('admin-mode');
    return () => document.body.classList.remove('admin-mode');
  }, []);

  return null;
}
