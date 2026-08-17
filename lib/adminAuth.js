import crypto from 'crypto';

// Server-only helpers for the /admin password gate. Deliberately built on
// Node's built-in `crypto` module rather than a JWT library, so there's no
// new npm dependency to verify against a build we can't run in this
// sandbox -- fewer moving parts, easier to review line by line.
//
// The admin "session" is a single httpOnly cookie containing an expiry
// timestamp plus an HMAC-SHA256 signature over it, keyed by
// ADMIN_SESSION_SECRET. Because the signature can only be produced by
// someone who knows that secret, the cookie can't be forged or its expiry
// extended by tampering with it client-side.

export const ADMIN_COOKIE_NAME = 'salehop_admin';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const ADMIN_SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

function getSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error('ADMIN_SESSION_SECRET is not set in this environment.');
  }
  return secret;
}

function sign(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
}

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Checks a submitted password against ADMIN_PASSWORD with a constant-time
// comparison, so response timing can't leak how many characters matched.
export function checkAdminPassword(password) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !password) return false;
  return timingSafeStringEqual(password, expected);
}

// Builds the value to store in the admin session cookie after a
// successful login.
export function createAdminSessionValue() {
  const expires = Date.now() + SESSION_TTL_MS;
  const signature = sign(`admin:${expires}`);
  return `${expires}.${signature}`;
}

// Verifies a cookie value came from createAdminSessionValue() (not forged)
// and hasn't expired.
export function verifyAdminSessionValue(value) {
  if (!value || typeof value !== 'string') return false;
  const [expiresStr, signature] = value.split('.');
  if (!expiresStr || !signature) return false;

  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || Date.now() > expires) return false;

  const expectedSignature = sign(`admin:${expiresStr}`);
  return timingSafeStringEqual(signature, expectedSignature);
}

// Convenience check for API routes: reads the admin cookie off a NextRequest
// and verifies it in one call. Fails closed (treated as "not an admin")
// rather than throwing if ADMIN_SESSION_SECRET isn't set yet, so a missing
// env var during setup shows up as "please sign in" instead of a crash.
export function isAdminRequest(request) {
  try {
    const cookieValue = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
    return verifyAdminSessionValue(cookieValue);
  } catch {
    return false;
  }
}
