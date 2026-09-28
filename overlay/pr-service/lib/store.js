/**
 * Key/value store with TTL, used for sessions, OAuth state nonces, cached
 * installation tokens and rate-limit counters.
 *
 * Two backends:
 *   - memory  — the default. Fine for a single long-lived process; useless
 *               across serverless instances, so it warns when used in production.
 *   - upstash — Redis over HTTP, enabled by setting UPSTASH_REDIS_REST_URL and
 *               UPSTASH_REDIS_REST_TOKEN. Uses plain fetch, no extra dependency.
 */

import { log } from './logger.js';

/** In-process map with lazy expiry. */
export function createMemoryStore() {
  const map = new Map();

  const alive = (entry) => entry && (entry.expiresAt === null || entry.expiresAt > Date.now());

  return {
    kind: 'memory',

    async get(key) {
      const entry = map.get(key);
      if (!alive(entry)) {
        map.delete(key);
        return null;
      }
      return entry.value;
    },

    async set(key, value, ttlSeconds = null) {
      map.set(key, {
        value,
        expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
      });
    },

    async del(key) {
      map.delete(key);
    },

    async incr(key, ttlSeconds) {
      const entry = map.get(key);
      const current = alive(entry) ? Number(entry.value) : 0;
      const next = current + 1;
      map.set(key, {
        value: next,
        // Keep the original window: only set expiry when starting a new one.
        expiresAt: alive(entry) ? entry.expiresAt : Date.now() + ttlSeconds * 1000,
      });
      return next;
    },

    /** Test helper. */
    _clear() {
      map.clear();
    },
  };
}

/** Upstash Redis over its HTTP API. */
export function createUpstashStore({ url, token, fetchImpl = fetch }) {
  async function command(args) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      throw new Error(`Upstash ${args[0]} failed: HTTP ${res.status}`);
    }
    const body = await res.json();
    return body.result;
  }

  return {
    kind: 'upstash',

    async get(key) {
      const raw = await command(['GET', key]);
      if (raw === null || raw === undefined) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    },

    async set(key, value, ttlSeconds = null) {
      const payload = JSON.stringify(value);
      const args = ttlSeconds
        ? ['SET', key, payload, 'EX', String(ttlSeconds)]
        : ['SET', key, payload];
      await command(args);
    },

    async del(key) {
      await command(['DEL', key]);
    },

    async incr(key, ttlSeconds) {
      const next = await command(['INCR', key]);
      // Only attach a TTL when this call opened the window.
      if (next === 1) await command(['EXPIRE', key, String(ttlSeconds)]);
      return Number(next);
    },
  };
}

/**
 * The store is pinned to globalThis, not to a module-level variable.
 *
 * Next bundles every API route separately, so each route gets its own copy
 * of this module — and with it its own Map. A nonce written by
 * /api/auth/extension was therefore invisible to
 * /api/auth/extension-callback, and every OAuth attempt failed on an
 * "already-used state parameter" that had in fact never been seen. A symbol
 * on globalThis is shared by every bundle in the process.
 */
const STORE_KEY = Symbol.for('inline-edit.store');

export function getStore() {
  if (globalThis[STORE_KEY]) return globalThis[STORE_KEY];

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    globalThis[STORE_KEY] = createUpstashStore({ url, token });
  } else {
    if (process.env.NODE_ENV === 'production') {
      log.warn('store.memory_in_production', {
        detail:
          'Sessions are held in process memory. They will not survive a ' +
          'restart, and on a host that runs more than one instance a request ' +
          'may land somewhere that has never seen the session. Set ' +
          'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.',
      });
    }
    globalThis[STORE_KEY] = createMemoryStore();
  }

  return globalThis[STORE_KEY];
}

/** Test seam. */
export function setStore(store) {
  globalThis[STORE_KEY] = store;
}
