import { describe, it, expect } from 'vitest';
import { splitRepository } from '../apps/api/src/providers/repository-name';

describe('splitRepository', () => {
  it('splits owner and name', () => {
    expect(splitRepository('iFrontida/website-revamp')).toEqual({
      owner: 'iFrontida',
      repo: 'website-revamp',
    });
  });

  it('accepts the characters providers actually allow', () => {
    expect(splitRepository('acme-co/my.site_v2')).toEqual({ owner: 'acme-co', repo: 'my.site_v2' });
  });

  it('trims surrounding whitespace', () => {
    expect(splitRepository('  acme/site  ')).toEqual({ owner: 'acme', repo: 'site' });
  });

  it('refuses path traversal', () => {
    // The one that matters: this string is interpolated into a URL called
    // with another company's write credentials.
    for (const bad of ['acme/../../other', '../acme/site', 'acme/..', '../..', './site']) {
      expect(() => splitRepository(bad), bad).toThrow(/not a repository name/);
    }
  });

  it('refuses a query string or fragment smuggled into the name', () => {
    for (const bad of ['acme/site?ref=main', 'acme/site#frag', 'acme/site%2F..']) {
      expect(() => splitRepository(bad), bad).toThrow();
    }
  });

  it('refuses a full URL', () => {
    expect(() => splitRepository('https://github.com/acme/site')).toThrow();
  });

  it('refuses the wrong number of segments', () => {
    for (const bad of ['site', 'acme/site/sub', 'acme/', '/site', '/', '']) {
      expect(() => splitRepository(bad), bad).toThrow();
    }
  });

  it('refuses .git', () => {
    expect(() => splitRepository('acme/.git')).toThrow();
    expect(() => splitRepository('acme/.GIT')).toThrow();
  });

  it('refuses a missing value rather than throwing a type error', () => {
    for (const bad of [undefined, null]) {
      expect(() => splitRepository(bad)).toThrow(/not a repository name/);
    }
  });

  it('reports the offending value, so the admin can see the typo', () => {
    expect(() => splitRepository('acme site')).toThrow(/"acme site"/);
  });
});
