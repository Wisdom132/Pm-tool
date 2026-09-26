/**
 * Fixed-window rate limiting backed by the shared store.
 *
 * Fixed windows allow a burst at a boundary, which is an acceptable trade for
 * the simplicity here — the aim is to stop a runaway client or a stolen
 * session from opening hundreds of pull requests, not to shape traffic.
 */

import { getStore } from './store.js';

export const LIMITS = {
  // Opening a PR costs several GitHub API calls and creates a branch.
  createPr: { limit: 20, windowSeconds: 60 * 60 },
  // Read-only endpoints are cheap but still worth bounding.
  read: { limit: 300, windowSeconds: 60 * 60 },
};

/**
 * Count one request against a bucket.
 *
 * @returns {Promise<{allowed: boolean, remaining: number, limit: number, retryAfter: number}>}
 */
export async function consume(bucket, identifier, { limit, windowSeconds }) {
  // Align the key to the window so counters reset without a sweeper.
  const window = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `rl:${bucket}:${identifier}:${window}`;

  const count = await getStore().incr(key, windowSeconds);

  const windowEndsAt = (window + 1) * windowSeconds * 1000;
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    limit,
    retryAfter: Math.max(1, Math.ceil((windowEndsAt - Date.now()) / 1000)),
  };
}

/**
 * Apply a limit and, when exceeded, write a 429 and return false.
 *
 * @returns {Promise<boolean>} whether the caller should continue
 */
export async function enforce(res, bucket, identifier, config) {
  const result = await consume(bucket, identifier, config);

  res.setHeader('X-RateLimit-Limit', String(result.limit));
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));

  if (!result.allowed) {
    res.setHeader('Retry-After', String(result.retryAfter));
    res.status(429).json({
      error: `Rate limit exceeded. Try again in ${result.retryAfter}s.`,
    });
    return false;
  }

  return true;
}
