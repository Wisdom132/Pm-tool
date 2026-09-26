/**
 * Authenticated encryption for the GitHub tokens held in the session store.
 *
 * The store may be a shared Redis instance, so tokens are never written in
 * plaintext. AES-256-GCM; the key comes from TOKEN_SECRET.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const IV_BYTES = 12; // GCM standard nonce length
const VERSION = 'v1';

/**
 * Derive a 32-byte key from TOKEN_SECRET.
 *
 * Read lazily rather than at module load so an unset variable surfaces as a
 * request error instead of crashing the whole server at import time.
 */
function key() {
  const secret = process.env.TOKEN_SECRET;
  if (!secret) throw new Error('TOKEN_SECRET is not set');
  return createHash('sha256').update(secret).digest();
}

/** @returns {string} "v1.<iv>.<tag>.<ciphertext>", all base64url */
export function encrypt(plaintext) {
  if (typeof plaintext !== 'string') throw new Error('encrypt expects a string');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/** Throws if the payload was tampered with or the key changed. */
export function decrypt(payload) {
  if (typeof payload !== 'string') throw new Error('decrypt expects a string');

  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Malformed ciphertext');
  }

  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Cryptographically random opaque identifier, safe for URLs. */
export function randomId(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}
