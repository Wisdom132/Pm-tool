/**
 * Matching a page's hostname to a registered site.
 *
 * A wildcard covers preview deploys, where every deployment gets its own
 * hostname: `*.acme.vercel.app`. Exactly one label, at the front — `*.acme`
 * and `a.*.b` are not accepted, because a wildcard in the middle makes
 * precedence ambiguous and nobody needs it.
 *
 * Precedence is most-specific-wins, so registering `staging.acme.com` beside
 * `*.acme.com` sends staging where it was told rather than wherever the
 * wildcard happened to point.
 */

export interface HostnamePattern {
  hostname: string;
}

/** Does `hostname` match `pattern`? Case-insensitive, port and trailing dot ignored. */
export function hostnameMatches(pattern: string, hostname: string): boolean {
  const p = normalise(pattern);
  const h = normalise(hostname);
  if (!p || !h) return false;

  if (!p.startsWith('*.')) return p === h;

  const suffix = p.slice(2);
  if (!suffix) return false;

  // "*.acme.com" covers "preview.acme.com" but not "acme.com" itself: the
  // wildcard stands for a label, and a missing label is a different site.
  if (!h.endsWith(`.${suffix}`)) return false;

  const label = h.slice(0, -(suffix.length + 1));
  return label.length > 0 && !label.includes('.');
}

/**
 * The best match, or null.
 *
 * Exact beats wildcard; a longer wildcard suffix beats a shorter one, so
 * `*.preview.acme.com` wins over `*.acme.com` for a host under both.
 */
export function bestMatch<T extends HostnamePattern>(candidates: T[], hostname: string): T | null {
  let winner: T | null = null;
  let winnerScore = -1;

  for (const candidate of candidates) {
    if (!hostnameMatches(candidate.hostname, hostname)) continue;

    const pattern = normalise(candidate.hostname);
    // Exact matches sort above every wildcard, whatever its length.
    const score = pattern.startsWith('*.') ? pattern.length : 10_000 + pattern.length;

    if (score > winnerScore) {
      winner = candidate;
      winnerScore = score;
    }
  }

  return winner;
}

/** Reject a pattern we cannot reason about, rather than store it and guess later. */
export function validateHostnamePattern(pattern: string): string | null {
  const raw = String(pattern ?? '').trim();
  if (!raw) return 'A hostname is required.';

  // Checked before normalising: normalise() drops everything after a colon to
  // strip the port, which would turn "https://acme.com/x" into "https" and
  // report a confusing reason for an otherwise correct rejection.
  if (/^[a-z]+:\/\//i.test(raw) || raw.includes('/') || raw.includes(' ')) {
    return 'That is a URL, not a hostname. Use just the host, like acme.com.';
  }

  const p = normalise(raw);
  if (!p) return 'A hostname is required.';

  const labels = p.split('.');
  if (labels.length < 2) return 'A hostname needs at least two labels, like acme.com.';

  const wildcards = labels.filter((l) => l.includes('*'));
  if (wildcards.length > 1) return 'Only one wildcard is allowed.';
  if (wildcards.length === 1) {
    if (labels[0] !== '*') return 'A wildcard has to be the whole first label, like *.acme.com.';
  }

  const rest = labels.slice(wildcards.length ? 1 : 0);
  if (rest.some((l) => !/^[a-z0-9-]+$/.test(l))) return 'That hostname has characters we cannot match on.';

  return null;
}

function normalise(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .split(':')[0];
}
