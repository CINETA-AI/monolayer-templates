import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// CSRF protection for the app's own state-changing routes (Better Auth protects its own).
// Two layers:
//  1. Origin check — a mutating request must come from the app's public origin.
//  2. Session-bound token — GET /account/api/csrf returns <nonce>.<hmac(secret, session|nonce)>;
//     mutating requests echo it in X-CSRF-Token. Another site can't read it (same-origin
//     policy) or forge it (it needs CSRF_SECRET), and it's useless with another session.

const b64 = (b: Buffer) => b.toString('base64url')

function sign(secret: string, sessionId: string, nonce: string): string {
  return b64(createHmac('sha256', secret).update(`${sessionId}|${nonce}`).digest())
}

export function issueCsrfToken(secret: string, sessionId: string): string {
  const nonce = b64(randomBytes(18))
  return `${nonce}.${sign(secret, sessionId, nonce)}`
}

export function verifyCsrfToken(secret: string, sessionId: string, token: string | undefined | null): boolean {
  if (!token) return false
  const [nonce, mac] = token.split('.')
  if (!nonce || !mac) return false
  const expected = Buffer.from(sign(secret, sessionId, nonce))
  const given = Buffer.from(mac)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Origin check: absent Origin (same-origin GET/HEAD from old clients) is tolerated only
 *  on safe methods; a present Origin must be the app's own. */
export function originAllowed(method: string, origin: string | undefined, publicUrl: string): boolean {
  if (!MUTATING.has(method)) return true
  if (!origin) return false
  if (!publicUrl) return true // gateway not live yet (no PUBLIC_URL) — the token still guards
  return origin === publicUrl
}
