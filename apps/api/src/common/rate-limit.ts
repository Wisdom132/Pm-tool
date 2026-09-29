/**
 * Fixed-window rate limiting.
 *
 * Ported from `lib/rate-limit.js`, which counted into the KV store the old
 * service used for sessions. That store is gone, so counters live in this
 * process.
 *
 * **The caveat, stated rather than buried:** with N API instances the
 * effective limit is N times the configured one, because each keeps its own
 * counters. That is acceptable for what this defends against — a runaway
 * client or a stolen session opening hundreds of pull requests — and it is
 * not acceptable as a billing control. Moving the counters to Postgres or
 * Redis is a small change to `hit()` alone; the call sites do not care.
 *
 * Fixed windows also permit a burst across a boundary: 2× the limit in one
 * instant, at the seam between two windows. Same reasoning — the aim is a
 * ceiling, not traffic shaping.
 */

export interface Limit {
  limit: number;
  windowSeconds: number;
}

export const LIMITS = {
  /** Opening a change request costs several provider calls and a branch. */
  write: { limit: 20, windowSeconds: 60 * 60 },
  /** Reads are cheap but still worth bounding. */
  read: { limit: 300, windowSeconds: 60 * 60 },
  /** Code search is metered separately by GitHub and much stricter. */
  search: { limit: 60, windowSeconds: 60 * 60 },

  /**
   * Public feedback, per visitor address.
   *
   * The only endpoint here that an unauthenticated stranger can reach, so
   * it is the only one where the limit is the whole defence rather than a
   * backstop.
   *
   * Twenty an hour is generous for a person and useless for a script. It is
   * not lower because addresses are shared: an office behind one NAT, or a
   * mobile network, is many real visitors wearing one address, and a limit
   * of two would silently swallow the second person's comment.
   */
  feedbackIp: { limit: 20, windowSeconds: 60 * 60 },

  /**
   * Public feedback, per site.
   *
   * The per-address limit does nothing against a flood from many addresses,
   * which is what a botnet is. This one bounds the damage to the inbox no
   * matter how the traffic is spread — the owner finds a full inbox rather
   * than an unusable one, and the site's own off switch is one flag away.
   */
  feedbackSite: { limit: 500, windowSeconds: 60 * 60 },
} as const satisfies Record<string, Limit>;

export interface Verdict {
  allowed: boolean;
  remaining: number;
  limit: number;
  /** Seconds until the window rolls over. */
  retryAfter: number;
}

const counters = new Map<string, number>();

/**
 * Count one request against a bucket.
 *
 * The window index is part of the key, so counters reset without a sweeper.
 * A periodic prune keeps the map from growing with every distinct key — the
 * old KV store got this free from TTLs.
 */
export function hit(bucket: string, identifier: string, config: Limit): Verdict {
  const window = Math.floor(Date.now() / (config.windowSeconds * 1000));
  const key = `${bucket}:${identifier}:${window}`;

  const count = (counters.get(key) ?? 0) + 1;
  counters.set(key, count);

  if (counters.size > 10_000) prune(window);

  const windowEndsAt = (window + 1) * config.windowSeconds * 1000;

  return {
    allowed: count <= config.limit,
    remaining: Math.max(0, config.limit - count),
    limit: config.limit,
    retryAfter: Math.max(1, Math.ceil((windowEndsAt - Date.now()) / 1000)),
  };
}

/**
 * Drop counters from windows that have passed.
 *
 * Keyed on the window index rather than a timestamp, so this cannot delete a
 * live counter: the current window's keys all end in `:<window>`.
 */
function prune(currentWindow: number): void {
  for (const key of counters.keys()) {
    const window = Number(key.slice(key.lastIndexOf(':') + 1));
    if (Number.isFinite(window) && window < currentWindow) counters.delete(key);
  }
}

/** Test seam. Nothing in the application should need this. */
export function reset(): void {
  counters.clear();
}
