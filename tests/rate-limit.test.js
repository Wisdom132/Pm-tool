import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { hit, reset, LIMITS } from '../apps/api/src/editing/rate-limit';

beforeEach(() => reset());
afterEach(() => vi.useRealTimers());

const small = { limit: 3, windowSeconds: 60 };

describe('hit', () => {
  it('allows up to the limit and then refuses', () => {
    const verdicts = [1, 2, 3, 4].map(() => hit('write', 'user-1', small));
    expect(verdicts.map((v) => v.allowed)).toEqual([true, true, true, false]);
  });

  it('counts down the remaining allowance', () => {
    expect(hit('write', 'user-1', small).remaining).toBe(2);
    expect(hit('write', 'user-1', small).remaining).toBe(1);
    expect(hit('write', 'user-1', small).remaining).toBe(0);
    // Never negative: it is shown to a user in a header.
    expect(hit('write', 'user-1', small).remaining).toBe(0);
  });

  it('keeps separate counters per identifier', () => {
    for (let i = 0; i < 3; i++) hit('write', 'noisy', small);
    expect(hit('write', 'noisy', small).allowed).toBe(false);
    // One user exhausting their budget must not spend anyone else's.
    expect(hit('write', 'quiet', small).allowed).toBe(true);
  });

  it('keeps separate counters per bucket', () => {
    for (let i = 0; i < 3; i++) hit('write', 'user-1', small);
    expect(hit('write', 'user-1', small).allowed).toBe(false);
    expect(hit('read', 'user-1', small).allowed).toBe(true);
  });

  it('reports seconds until the window rolls over', () => {
    const v = hit('write', 'user-1', small);
    expect(v.retryAfter).toBeGreaterThan(0);
    expect(v.retryAfter).toBeLessThanOrEqual(small.windowSeconds);
  });

  it('resets when the window rolls over', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
    for (let i = 0; i < 3; i++) hit('write', 'user-1', small);
    expect(hit('write', 'user-1', small).allowed).toBe(false);

    vi.setSystemTime(new Date('2026-01-01T10:01:30Z'));
    expect(hit('write', 'user-1', small).allowed).toBe(true);
  });

  it('prunes old windows without dropping the live one', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));

    // Enough distinct identifiers to cross the prune threshold.
    for (let i = 0; i < 10_001; i++) hit('read', `user-${i}`, small);

    vi.setSystemTime(new Date('2026-01-01T10:02:00Z'));
    hit('read', 'someone', small);

    // The current window's counter must have survived the prune: a second
    // hit is the 2nd, not the 1st.
    expect(hit('read', 'someone', small).remaining).toBe(1);
  });
});

describe('the configured limits', () => {
  it('lets writes through far less often than reads', () => {
    // Opening a change request costs several provider calls and a branch.
    expect(LIMITS.write.limit).toBeLessThan(LIMITS.read.limit);
  });

  it('meters search more tightly than other reads', () => {
    // GitHub bills code search against a separate, much stricter quota.
    expect(LIMITS.search.limit).toBeLessThan(LIMITS.read.limit);
  });

  it('uses an hour window throughout', () => {
    for (const config of Object.values(LIMITS)) {
      expect(config.windowSeconds).toBe(3600);
    }
  });
});
