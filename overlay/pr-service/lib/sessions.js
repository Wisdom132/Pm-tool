/**
 * Server-side sessions.
 *
 * The extension holds only an opaque random session ID. GitHub tokens stay
 * here, encrypted, and can be revoked centrally — unlike the previous design,
 * where a year-long JWT carried the raw token in a readable payload.
 */

import { getStore } from './store.js';
import { encrypt, decrypt, randomId } from './crypto.js';
import { log } from './logger.js';

/** Sessions last a working fortnight, not a year. */
export const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;

const PREFIX = 'sess:';

/**
 * @param {{githubToken: string, refreshToken?: string, login: string, userId: string|number}} data
 * @returns {Promise<{sessionId: string, expiresAt: number}>}
 */
export async function createSession({ githubToken, refreshToken, login, userId }) {
  if (!githubToken) throw new Error('createSession requires a githubToken');

  const sessionId = randomId();
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;

  await getStore().set(
    PREFIX + sessionId,
    {
      gh: encrypt(githubToken),
      refresh: refreshToken ? encrypt(refreshToken) : null,
      login,
      userId: String(userId),
      createdAt: Date.now(),
      expiresAt,
    },
    SESSION_TTL_SECONDS
  );

  log.info('session.created', { login, userId: String(userId) });
  return { sessionId, expiresAt };
}

/**
 * @returns {Promise<{githubToken: string, refreshToken: string|null, login: string, userId: string}|null>}
 */
export async function readSession(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return null;

  const record = await getStore().get(PREFIX + sessionId);
  if (!record) return null;

  // Memory store expires lazily; belt and braces for a stale record.
  if (record.expiresAt && record.expiresAt < Date.now()) {
    await destroySession(sessionId);
    return null;
  }

  try {
    return {
      githubToken: decrypt(record.gh),
      refreshToken: record.refresh ? decrypt(record.refresh) : null,
      login: record.login,
      userId: record.userId,
    };
  } catch (err) {
    // Wrong key or tampered payload — treat as no session rather than 500.
    log.warn('session.decrypt_failed', { error: err.message });
    return null;
  }
}

export async function destroySession(sessionId) {
  if (!sessionId) return;
  await getStore().del(PREFIX + sessionId);
}
