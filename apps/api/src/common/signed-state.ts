import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed, expiring state for provider redirects.
 *
 * The provider takes a `state` parameter, sends the admin away, and hands it
 * back on the callback. It is the only thing tying "an installation was just
 * created" to "this organisation asked for it" — without it, whoever
 * completes an install chooses which organisation it lands in, and that is
 * one request away from attaching your repositories to a stranger's account.
 *
 * Signed rather than stored: the payload is small, the lifetime is minutes,
 * and a row per redirect is a table that needs expiring. The tradeoff is
 * that a signed state cannot be revoked before it expires, which is why the
 * expiry is short and the callback checks the session as well.
 */

const SEPARATOR = '.';

/** Ten minutes: long enough to read GitHub's install screen, short enough not to linger. */
export const STATE_TTL_MS = 10 * 60 * 1000;

export interface StatePayload {
  organisationId: string;
  userId: string;
}

/**
 * A signing key distinct from the credential-encryption key, derived from it.
 *
 * Using the encryption key directly for HMAC would mean one key serving two
 * algorithms — the kind of reuse that turns a weakness in one into a
 * weakness in both. Domain separation costs a hash.
 */
export function deriveStateKey(encryptionKey: Buffer): Buffer {
  return createHmac('sha256', encryptionKey).update('inline-edit/provider-state').digest();
}

export function signState(payload: StatePayload, key: Buffer, now = Date.now()): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: now + STATE_TTL_MS }),
    'utf8',
  ).toString('base64url');

  return `${body}${SEPARATOR}${sign(body, key)}`;
}

/**
 * @throws if the state was not signed by us, is malformed, or has expired.
 *         One error type for all three: telling a caller *which* only helps
 *         someone probing the endpoint.
 */
export function verifyState(state: string, key: Buffer, now = Date.now()): StatePayload {
  const invalid = () => new Error('This link has expired or is not valid. Start the connection again.');

  const [body, signature] = String(state ?? '').split(SEPARATOR);
  if (!body || !signature) throw invalid();

  const expected = sign(body, key);
  // Compare before parsing: never parse JSON that has not been authenticated.
  if (!equals(signature, expected)) throw invalid();

  let parsed: StatePayload & { exp?: number };
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }

  if (!parsed.organisationId || !parsed.userId) throw invalid();
  if (typeof parsed.exp !== 'number' || parsed.exp < now) throw invalid();

  return { organisationId: parsed.organisationId, userId: parsed.userId };
}

function sign(body: string, key: Buffer): string {
  return createHmac('sha256', key).update(body).digest('base64url');
}

function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
