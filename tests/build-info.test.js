import { describe, it, expect } from 'vitest';
import {
  resolveBuildInfo,
  isAnnotationEnabled,
  buildInfoAttrs,
  buildInfoAttrString,
  stampHtmlTag,
  parseRepoUrl,
} from '../annotation/lib/build-info.js';

/** Fallbacks that return nothing, so tests never shell out to git. */
const NO_GIT = { branch: () => null, commit: () => null, repo: () => null };

/** Fallbacks standing in for a normal local checkout. */
const LOCAL_GIT = {
  branch: () => 'local-branch',
  commit: () => 'localsha',
  repo: () => 'local/repo',
};

describe('parseRepoUrl', () => {
  it.each([
    ['https://github.com/acme/site.git', 'acme/site'],
    ['https://github.com/acme/site', 'acme/site'],
    ['https://github.com/acme/site/', 'acme/site'],
    ['git@github.com:acme/site.git', 'acme/site'],
    ['ssh://git@github.com/acme/site.git', 'acme/site'],
    ['https://gitlab.com/acme/site.git', 'acme/site'],
  ])('parses %s', (url, expected) => {
    expect(parseRepoUrl(url)).toBe(expected);
  });

  it('returns null for empty or unusable input', () => {
    expect(parseRepoUrl('')).toBeNull();
    expect(parseRepoUrl(undefined)).toBeNull();
  });
});

describe('resolveBuildInfo — CI providers', () => {
  it('reads Vercel variables', () => {
    const info = resolveBuildInfo(
      {
        VERCEL: '1',
        VERCEL_GIT_COMMIT_REF: 'feature/pricing',
        VERCEL_GIT_COMMIT_SHA: 'abc123',
        VERCEL_GIT_REPO_OWNER: 'acme',
        VERCEL_GIT_REPO_SLUG: 'site',
      },
      NO_GIT
    );
    expect(info).toEqual({
      branch: 'feature/pricing',
      commit: 'abc123',
      repo: 'acme/site',
      provider: 'vercel',
    });
  });

  it('reads Netlify variables and derives the repo from REPOSITORY_URL', () => {
    const info = resolveBuildInfo(
      {
        NETLIFY: 'true',
        BRANCH: 'feature/pricing',
        COMMIT_REF: 'abc123',
        REPOSITORY_URL: 'https://github.com/acme/site',
      },
      NO_GIT
    );
    expect(info).toMatchObject({
      branch: 'feature/pricing',
      commit: 'abc123',
      repo: 'acme/site',
      provider: 'netlify',
    });
  });

  it('reads GitHub Actions variables', () => {
    const info = resolveBuildInfo(
      {
        GITHUB_ACTIONS: 'true',
        GITHUB_REF_NAME: 'main',
        GITHUB_SHA: 'abc123',
        GITHUB_REPOSITORY: 'acme/site',
      },
      NO_GIT
    );
    expect(info).toMatchObject({ branch: 'main', repo: 'acme/site', provider: 'github-actions' });
  });

  it('prefers GITHUB_HEAD_REF on pull_request events', () => {
    // On pull_request, GITHUB_REF_NAME is "123/merge" — not a real branch.
    const info = resolveBuildInfo(
      {
        GITHUB_ACTIONS: 'true',
        GITHUB_REF_NAME: '123/merge',
        GITHUB_HEAD_REF: 'feature/pricing',
        GITHUB_SHA: 'abc123',
      },
      NO_GIT
    );
    expect(info.branch).toBe('feature/pricing');
  });

  it('reads Amplify variables', () => {
    const info = resolveBuildInfo(
      { AWS_APP_ID: 'd123', AWS_BRANCH: 'staging', AWS_COMMIT_ID: 'abc123' },
      NO_GIT
    );
    expect(info).toMatchObject({ branch: 'staging', commit: 'abc123', provider: 'amplify' });
  });

  it('reads Cloudflare Pages variables', () => {
    const info = resolveBuildInfo(
      { CF_PAGES: '1', CF_PAGES_BRANCH: 'staging', CF_PAGES_COMMIT_SHA: 'abc123' },
      NO_GIT
    );
    expect(info).toMatchObject({ branch: 'staging', commit: 'abc123', provider: 'cloudflare-pages' });
  });
});

describe('resolveBuildInfo — fallbacks', () => {
  it('falls back to git entirely when no CI variables are present', () => {
    const info = resolveBuildInfo({}, LOCAL_GIT);
    expect(info).toEqual({
      branch: 'local-branch',
      commit: 'localsha',
      repo: 'local/repo',
      provider: 'local',
    });
  });

  it('fills only the fields the provider did not supply', () => {
    // Amplify gives branch and commit but has no repository variable.
    const info = resolveBuildInfo(
      { AWS_BRANCH: 'staging', AWS_COMMIT_ID: 'abc123' },
      LOCAL_GIT
    );
    expect(info.branch).toBe('staging');
    expect(info.commit).toBe('abc123');
    expect(info.repo).toBe('local/repo');
  });

  it('never reports "HEAD" as a branch on a detached checkout', () => {
    // This is the whole reason CI variables come first: build hosts check out
    // a detached HEAD, where `git rev-parse --abbrev-ref HEAD` prints "HEAD".
    const detached = { ...LOCAL_GIT, branch: () => null };
    expect(resolveBuildInfo({}, detached).branch).toBeNull();
  });

  it('returns nulls when there is neither CI nor git', () => {
    expect(resolveBuildInfo({}, NO_GIT)).toEqual({
      branch: null,
      commit: null,
      repo: null,
      provider: 'local',
    });
  });

  it('treats blank environment values as absent', () => {
    const info = resolveBuildInfo(
      { VERCEL: '1', VERCEL_GIT_COMMIT_REF: '   ', VERCEL_GIT_COMMIT_SHA: 'abc123' },
      LOCAL_GIT
    );
    expect(info.branch).toBe('local-branch');
  });

  it('lets the manual override win over the provider', () => {
    const info = resolveBuildInfo(
      {
        VERCEL: '1',
        VERCEL_GIT_COMMIT_REF: 'from-vercel',
        INLINE_EDIT_BRANCH: 'override',
        INLINE_EDIT_REPO: 'me/mine',
      },
      NO_GIT
    );
    expect(info.branch).toBe('override');
    expect(info.repo).toBe('me/mine');
  });
});

describe('isAnnotationEnabled', () => {
  it.each(['1', 'true', 'TRUE', 'yes'])('enables on INLINE_EDIT=%s', (v) => {
    expect(isAnnotationEnabled(false, { INLINE_EDIT: v })).toBe(true);
  });

  it.each(['0', 'false', 'no'])('disables on INLINE_EDIT=%s even in dev', (v) => {
    expect(isAnnotationEnabled(true, { INLINE_EDIT: v })).toBe(false);
  });

  it('falls back to the dev signal when the flag is unset', () => {
    expect(isAnnotationEnabled(true, {})).toBe(true);
    expect(isAnnotationEnabled(false, {})).toBe(false);
  });

  it('treats an empty flag as unset', () => {
    expect(isAnnotationEnabled(true, { INLINE_EDIT: '' })).toBe(true);
  });

  it('enables a production preview build that opts in', () => {
    // The case the flag exists for: NODE_ENV=production, annotation wanted.
    expect(isAnnotationEnabled(false, { INLINE_EDIT: '1', NODE_ENV: 'production' })).toBe(true);
  });
});

describe('buildInfoAttrs', () => {
  it('emits all three attributes', () => {
    expect(buildInfoAttrs({ branch: 'main', commit: 'abc', repo: 'acme/site' })).toEqual({
      'data-edit-branch': 'main',
      'data-edit-commit': 'abc',
      'data-edit-repo': 'acme/site',
    });
  });

  it('omits missing fields', () => {
    expect(buildInfoAttrs({ branch: 'main', commit: null, repo: null })).toEqual({
      'data-edit-branch': 'main',
    });
  });

  it('renders nothing when everything is unknown', () => {
    expect(buildInfoAttrString({ branch: null, commit: null, repo: null })).toBe('');
  });

  it('escapes quotes in attribute values', () => {
    const s = buildInfoAttrString({ branch: 'a"b', commit: null, repo: null });
    expect(s).toBe(' data-edit-branch="a&quot;b"');
  });
});

describe('stampHtmlTag', () => {
  const info = { branch: 'main', commit: 'abc123', repo: 'acme/site' };

  it('adds the attributes to the <html> tag', () => {
    const out = stampHtmlTag('<!DOCTYPE html>\n<html lang="en">\n<body></body></html>', info);
    expect(out).toContain('data-edit-branch="main"');
    expect(out).toContain('data-edit-commit="abc123"');
    expect(out).toContain('data-edit-repo="acme/site"');
    expect(out).toContain('lang="en"');
  });

  it('leaves the document otherwise intact', () => {
    const out = stampHtmlTag('<html>\n<body>hi</body>\n</html>', info);
    expect(out).toContain('<body>hi</body>');
    expect(out).toContain('</html>');
  });

  it('is idempotent', () => {
    const once = stampHtmlTag('<html lang="en">x</html>', info);
    expect(stampHtmlTag(once, info)).toBe(once);
  });

  it('does not match the closing </html> tag', () => {
    const out = stampHtmlTag('<html>x</html>', info);
    expect(out.match(/data-edit-branch/g)).toHaveLength(1);
    expect(out).toContain('</html>');
  });

  it('returns the document untouched when nothing is known', () => {
    const html = '<html lang="en">x</html>';
    expect(stampHtmlTag(html, { branch: null, commit: null, repo: null })).toBe(html);
  });

  it('handles an <html> tag with no attributes', () => {
    expect(stampHtmlTag('<html>x</html>', info)).toContain('<html data-edit-branch="main"');
  });
});
