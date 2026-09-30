import { describe, it, expect } from 'vitest';
import {
  resolveBuildInfo,
  isAnnotationEnabled,
  hostDeployKind,
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

// ============================================================
//  Deploy-kind detection
//
//  The safety property is one-directional: a host that says
//  "production" must never be overridden by anything below it.
//  Annotations name every source file on the page, so a false
//  positive publishes a company's directory structure — and
//  unlike a broken build, nobody notices.
// ============================================================
describe('hostDeployKind', () => {
  it('reads Vercel', () => {
    expect(hostDeployKind({ VERCEL_ENV: 'production' })).toBe('production');
    expect(hostDeployKind({ VERCEL_ENV: 'preview' })).toBe('preview');
    expect(hostDeployKind({ VERCEL_ENV: 'development' })).toBe('preview');
  });

  it('reads Netlify', () => {
    expect(hostDeployKind({ CONTEXT: 'production' })).toBe('production');
    expect(hostDeployKind({ CONTEXT: 'deploy-preview' })).toBe('preview');
    expect(hostDeployKind({ CONTEXT: 'branch-deploy' })).toBe('preview');
  });

  it('reads Cloudflare Pages by comparing against its production branch', () => {
    expect(
      hostDeployKind({ CF_PAGES_BRANCH: 'feat/x', CF_PAGES_PRODUCTION_BRANCH: 'main' })
    ).toBe('preview');
    expect(
      hostDeployKind({ CF_PAGES_BRANCH: 'main', CF_PAGES_PRODUCTION_BRANCH: 'main' })
    ).toBeNull();
  });

  it('reads a Render pull-request deploy', () => {
    expect(hostDeployKind({ IS_PULL_REQUEST: 'true' })).toBe('preview');
  });

  it('says nothing for hosts that cannot answer', () => {
    // Amplify sets a branch but never says what it is for, and a GitHub
    // Actions run is not a deployment at all. Guessing from the branch name
    // would publish source layout for every team whose production branch is
    // not called "main".
    expect(hostDeployKind({ AWS_BRANCH: 'main' })).toBeNull();
    expect(hostDeployKind({ GITHUB_ACTIONS: 'true', GITHUB_REF_NAME: 'main' })).toBeNull();
    expect(hostDeployKind({})).toBeNull();
  });
});

describe('isAnnotationEnabled — automatic on preview deploys', () => {
  it('annotates a preview deploy with no configuration at all', () => {
    // The change this makes. A preview builds with NODE_ENV=production, so
    // the dev signal never fired and the deploy an editor was sent to had
    // no annotations — the most common way this product looked broken.
    expect(isAnnotationEnabled(false, { VERCEL_ENV: 'preview', NODE_ENV: 'production' })).toBe(true);
    expect(isAnnotationEnabled(false, { CONTEXT: 'deploy-preview', NODE_ENV: 'production' })).toBe(true);
  });

  it('never annotates a production deploy', () => {
    for (const env of [
      { VERCEL_ENV: 'production' },
      { CONTEXT: 'production' },
      { VERCEL_ENV: 'production', NODE_ENV: 'development' },
      // Even a dev signal must not override the host.
      { CONTEXT: 'production', NODE_ENV: 'development' },
    ]) {
      expect(isAnnotationEnabled(true, env), JSON.stringify(env)).toBe(false);
    }
  });

  it('lets INLINE_EDIT=0 opt a preview deploy out', () => {
    // The only way to exclude a sensitive branch from an annotated host.
    expect(isAnnotationEnabled(true, { VERCEL_ENV: 'preview', INLINE_EDIT: '0' })).toBe(false);
  });

  it('lets INLINE_EDIT=1 force it on an unrecognised host', () => {
    expect(isAnnotationEnabled(false, { NODE_ENV: 'production', INLINE_EDIT: '1' })).toBe(true);
  });

  it('does not infer anything from NODE_ENV', () => {
    // An earlier version of this treated `NODE_ENV !== 'production'` as a
    // signal. It is true in a test runner, in a CI job, and in any process
    // that never set it — so annotation switched on in places nobody was
    // deploying from. The existing "a production build must not annotate"
    // test caught it, which is exactly what that test is for.
    for (const env of [{ NODE_ENV: 'staging' }, { NODE_ENV: 'test' }, { NODE_ENV: '' }, {}]) {
      expect(isAnnotationEnabled(false, env), JSON.stringify(env)).toBe(false);
    }
  });

  it('still annotates plain local development', () => {
    expect(isAnnotationEnabled(true, {})).toBe(true);
  });
});
