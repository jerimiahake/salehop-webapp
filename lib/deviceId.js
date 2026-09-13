// A small, purely local (never sent anywhere except back to our own API as
// an opaque string) per-browser identifier -- used only so the
// crowdsourced "spotted a sale" reporting (see components/AppShell.js)
// can tell whether the same device already reported a given spot, without
// requiring anyone to sign in just to tap "I see a sale here." Not a real
// account id, not tied to anything else on the site, and never shown to
// the public -- only used server-side to stop one device from inflating a
// spot's report count on its own (see app/api/spotted-sales/route.js).
const DEVICE_ID_KEY = 'salehop:deviceId';

export function getOrCreateDeviceId() {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    // Storage blocked/unavailable -- fall back to a per-call random id.
    // Reporting/confirming still works, it just won't be recognized as
    // "the same device" on a later report from this browser.
    return `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
