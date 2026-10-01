import { describe, it, expect } from 'vitest';
import {
  detectBranchFromHostname,
  readBuildAttrs,
  resolvePageContext,
  describeSource,
} from '../inline-edit-tool/extension/src/page-context.js';

describe('detectBranchFromHostname', () => {
  it('reads an AWS Amplify preview hostname', () => {
    expect(detectBranchFromHostname('staging.d111111abcdef8.amplifyapp.com')).toBe('staging');
  });

  it('reads a Netlify branch deploy hostname', () => {
    expect(detectBranchFromHostname('staging--acme-site.netlify.app')).toBe('staging');
  });

  it('reads a Vercel preview hostname', () => {
    expect(detectBranchFromHostname('site-git-feature-pricing-acme.vercel.app')).toBe(
      'feature-pricing'
    );
  });

  it('ignores a Netlify production hostname with no branch segment', () => {
    expect(detectBranchFromHostname('acme-site.netlify.app')).toBeNull();
  });

  it('ignores unrelated hostnames', () => {
    expect(detectBranchFromHostname('www.example.com')).toBeNull();
    expect(detectBranchFromHostname('localhost')).toBeNull();
  });

  it('handles empty input', () => {
    expect(detectBranchFromHostname('')).toBeNull();
    expect(detectBranchFromHostname(undefined)).toBeNull();
  });
});

describe('readBuildAttrs', () => {
  it('reads the stamped attributes', () => {
    expect(
      readBuildAttrs({
        editBranch: 'feature/pricing',
        editCommit: 'abc123',
        editRepo: 'acme/site',
        editVersion: '1.2.0',
      })
    ).toEqual({
      branch: 'feature/pricing',
      commit: 'abc123',
      repo: 'acme/site',
      pluginVersion: '1.2.0',
    });
  });

  it('reports a null version for a page built before the attribute existed', () => {
    // A supported state, not an error — CONTRACT.md rule 3. The extension
    // reads it as "assume everything works" rather than warning somebody
    // about a plugin that is fine.
    const attrs = readBuildAttrs({ editBranch: 'main', editCommit: 'abc' });
    expect(attrs.pluginVersion).toBeNull();
  });

  it('returns nulls for an unannotated page', () => {
    expect(readBuildAttrs({})).toEqual({
      branch: null,
      commit: null,
      repo: null,
      pluginVersion: null,
    });
  });

  it('treats blank attributes as absent', () => {
    expect(readBuildAttrs({ editBranch: '  ' }).branch).toBeNull();
  });
});

describe('resolvePageContext', () => {
  it('prefers build attributes over the URL', () => {
    // The hostname says "staging"; the build says "feature/pricing". Build
    // wins, because hosts sanitise slashes out of preview hostnames.
    const ctx = resolvePageContext({
      dataset: { editBranch: 'feature/pricing', editRepo: 'acme/site', editCommit: 'abc' },
      hostname: 'staging--acme-site.netlify.app',
    });
    expect(ctx.branch).toBe('feature/pricing');
    expect(ctx.branchSource).toBe('build');
    expect(ctx.complete).toBe(true);
  });

  it('falls back to the URL when no branch was stamped', () => {
    const ctx = resolvePageContext({
      dataset: { editRepo: 'acme/site' },
      hostname: 'staging--acme-site.netlify.app',
    });
    expect(ctx.branch).toBe('staging');
    expect(ctx.branchSource).toBe('url');
    expect(ctx.complete).toBe(true);
  });

  it('is incomplete when the repo is unknown', () => {
    const ctx = resolvePageContext({
      dataset: { editBranch: 'main' },
      hostname: 'www.example.com',
    });
    expect(ctx.complete).toBe(false);
    expect(ctx.repoSource).toBeNull();
  });

  it('is incomplete when the branch is unknown', () => {
    const ctx = resolvePageContext({
      dataset: { editRepo: 'acme/site' },
      hostname: 'www.example.com',
    });
    expect(ctx.branch).toBeNull();
    expect(ctx.complete).toBe(false);
  });

  it('reports nothing for a plain unannotated page', () => {
    expect(resolvePageContext({ dataset: {}, hostname: 'www.example.com' })).toEqual({
      repo: null,
      branch: null,
      commit: null,
      repoSource: null,
      branchSource: null,
      complete: false,
    });
  });

  it('tolerates being called with no arguments', () => {
    expect(resolvePageContext().complete).toBe(false);
  });

  it('carries the build commit through', () => {
    const ctx = resolvePageContext({
      dataset: { editRepo: 'acme/site', editBranch: 'main', editCommit: 'deadbeef' },
    });
    expect(ctx.commit).toBe('deadbeef');
  });
});

describe('describeSource', () => {
  it('labels each provenance', () => {
    expect(describeSource('build')).toBe('from build');
    expect(describeSource('url')).toBe('from URL');
    expect(describeSource(null)).toBeNull();
  });
});
