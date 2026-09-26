/**
 * Single-use OAuth `state` nonces.
 *
 * The previous implementation base64-encoded the extension ID into `state`
 * and decoded it again on callback without verifying anything, so the
 * parameter provided no CSRF protection and the redirect target was fully
 * attacker-controlled. A nonce is now issued server-side, stored, and
 * consumed exactly once.
 */

import { getStore } from './store.js';
import { randomId } from './crypto.js';

/** An OAuth round trip is interactive; ten minutes is generous. */
export const STATE_TTL_SECONDS = 10 * 60;

const PREFIX = 'oauth_state:';

/** @returns {Promise<string>} the nonce to send to GitHub as `state` */
export async function issueState({ extensionId }) {
  const nonce = randomId(24);
  await getStore().set(
    PREFIX + nonce,
    { extensionId, createdAt: Date.now() },
    STATE_TTL_SECONDS
  );
  return nonce;
}

/**
 * Validate and burn a nonce.
 *
 * @returns {Promise<{extensionId: string}|null>} null if unknown, expired or already used
 */
export async function consumeState(nonce) {
  if (!nonce || typeof nonce !== 'string') return null;

  const store = getStore();
  const record = await store.get(PREFIX + nonce);
  if (!record) return null;

  // Delete before returning so a replayed callback cannot reuse it.
  await store.del(PREFIX + nonce);

  return { extensionId: record.extensionId };
}
