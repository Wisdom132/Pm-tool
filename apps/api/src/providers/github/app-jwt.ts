import { createPrivateKey, type KeyObject } from 'node:crypto';
import { SignJWT } from 'jose';

/**
 * Signing the JWT that identifies our GitHub App.
 *
 * Deliberately free of Nest: this is the credential handling that decides
 * whether we can act as the App at all, and it is easier to test — and to
 * review — as three pure functions than as methods on an injectable.
 */

/**
 * The PEM may arrive raw (with real newlines), with literal `\n` sequences,
 * or base64-encoded. All three are what hosting UIs produce when you paste a
 * multi-line secret into a single-line field, and rejecting two of them just
 * produces a confusing deploy failure.
 */
export function normalisePrivateKey(raw: string | undefined): string {
  if (!raw) throw new Error('GITHUB_APP_PRIVATE_KEY is not set');

  let key = raw.trim();

  if (!key.includes('BEGIN')) key = Buffer.from(key, 'base64').toString('utf8').trim();
  if (key.includes('\\n')) key = key.replace(/\\n/g, '\n');
  if (!key.includes('BEGIN')) throw new Error('GITHUB_APP_PRIVATE_KEY is not a valid PEM');

  return key;
}

/**
 * Parse a PEM into a signing key.
 *
 * GitHub issues App keys in PKCS#1 ("BEGIN RSA PRIVATE KEY"), while jose's
 * importPKCS8 accepts only PKCS#8 ("BEGIN PRIVATE KEY"). Node's
 * createPrivateKey reads both and returns something jose can sign with.
 */
export function loadPrivateKey(raw: string | undefined): KeyObject {
  return createPrivateKey(normalisePrivateKey(raw));
}

/**
 * A short-lived JWT identifying the App itself.
 *
 * `iat` is backdated 60 seconds to tolerate clock skew, per GitHub's own
 * guidance, and the expiry is 9 minutes because GitHub rejects anything
 * beyond 10.
 */
export async function createAppJwt(
  env: NodeJS.ProcessEnv = process.env,
  key?: KeyObject,
): Promise<string> {
  const appId = env.GITHUB_APP_ID;
  if (!appId) throw new Error('GITHUB_APP_ID is not set');

  const signingKey = key ?? loadPrivateKey(env.GITHUB_APP_PRIVATE_KEY);
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(String(appId))
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 9 * 60)
    .sign(signingKey);
}
