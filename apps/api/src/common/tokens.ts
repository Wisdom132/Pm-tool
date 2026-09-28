import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque tokens for sign-in links and sessions.
 *
 * Only ever stored hashed. These are bearer credentials — whoever holds one
 * is the user — so a database dump must not be a pile of working logins.
 *
 * SHA-256 rather than a password hash on purpose: these are 256 bits of
 * randomness, not a guessable secret, so there is nothing for bcrypt's work
 * factor to defend and it would only slow every authenticated request.
 */
export function createToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant time, so a comparison cannot be used to guess a token. */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
