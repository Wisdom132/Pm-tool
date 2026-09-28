import { describe, it, expect } from 'vitest';
import {
  hostnameMatches,
  bestMatch,
  validateHostnamePattern,
} from '../apps/api/src/sites/hostname';

describe('hostnameMatches', () => {
  it('matches an exact hostname', () => {
    expect(hostnameMatches('acme.com', 'acme.com')).toBe(true);
    expect(hostnameMatches('acme.com', 'other.com')).toBe(false);
  });

  it('ignores case, port and a trailing dot', () => {
    expect(hostnameMatches('Acme.com', 'acme.com:3000')).toBe(true);
    expect(hostnameMatches('acme.com', 'acme.com.')).toBe(true);
  });

  it('matches one label under a wildcard', () => {
    expect(hostnameMatches('*.acme.com', 'preview.acme.com')).toBe(true);
    expect(hostnameMatches('*.vercel.app', 'pr-42-acme.vercel.app')).toBe(true);
  });

  it('does not let a wildcard match the bare domain', () => {
    // `*.acme.com` stands for a label; without one it is a different site,
    // and matching it would hand preview access to production.
    expect(hostnameMatches('*.acme.com', 'acme.com')).toBe(false);
  });

  it('does not let one wildcard label span several', () => {
    // Otherwise `*.acme.com` would cover `evil.attacker.acme.com`.
    expect(hostnameMatches('*.acme.com', 'a.b.acme.com')).toBe(false);
  });

  it('does not match a different suffix', () => {
    expect(hostnameMatches('*.acme.com', 'preview.acme.com.evil.net')).toBe(false);
    expect(hostnameMatches('*.acme.com', 'preview.notacme.com')).toBe(false);
  });

  it('is not fooled by a suffix without the dot', () => {
    // "myacme.com" ends with "acme.com" as a string but is another domain.
    expect(hostnameMatches('*.acme.com', 'xmyacme.com')).toBe(false);
  });

  it('refuses empty input', () => {
    expect(hostnameMatches('', 'acme.com')).toBe(false);
    expect(hostnameMatches('*.acme.com', '')).toBe(false);
  });
});

describe('bestMatch', () => {
  const sites = [
    { id: 'prod', hostname: 'acme.com' },
    { id: 'staging', hostname: 'staging.acme.com' },
    { id: 'preview', hostname: '*.acme.com' },
    { id: 'deep', hostname: '*.preview.acme.com' },
  ];

  it('prefers an exact match over a wildcard', () => {
    // Registering staging explicitly has to beat the wildcard, or the branch
    // it was given is ignored.
    expect(bestMatch(sites, 'staging.acme.com')?.id).toBe('staging');
  });

  it('falls back to the wildcard when nothing is exact', () => {
    expect(bestMatch(sites, 'pr-7.acme.com')?.id).toBe('preview');
  });

  it('prefers the more specific wildcard', () => {
    expect(bestMatch(sites, 'x.preview.acme.com')?.id).toBe('deep');
  });

  it('returns null when nothing matches', () => {
    expect(bestMatch(sites, 'someone-else.com')).toBeNull();
  });

  it('does not match across organisations by accident', () => {
    // The caller scopes by organisation; this only ever sees one org's rows.
    expect(bestMatch([{ id: 'a', hostname: 'other.com' }], 'acme.com')).toBeNull();
  });
});

describe('validateHostnamePattern', () => {
  it('accepts a plain hostname and a leading wildcard', () => {
    expect(validateHostnamePattern('acme.com')).toBeNull();
    expect(validateHostnamePattern('*.acme.vercel.app')).toBeNull();
  });

  it('rejects a URL', () => {
    expect(validateHostnamePattern('https://acme.com/path')).toMatch(/URL/);
  });

  it('rejects a wildcard that is not the whole first label', () => {
    expect(validateHostnamePattern('*acme.com')).toMatch(/whole first label/);
    expect(validateHostnamePattern('a.*.acme.com')).toMatch(/whole first label|one wildcard/);
  });

  it('rejects more than one wildcard', () => {
    expect(validateHostnamePattern('*.*.acme.com')).toMatch(/one wildcard/);
  });

  it('rejects a single label', () => {
    expect(validateHostnamePattern('localhost')).toMatch(/two labels/);
  });

  it('requires a hostname', () => {
    expect(validateHostnamePattern('')).toMatch(/required/);
  });
});
