'use strict';

/**
 * Resolves the branch / commit / repository a build came from.
 *
 * Build hosts clone shallowly and check out a detached HEAD, so
 * `git rev-parse --abbrev-ref HEAD` returns the literal string "HEAD" — and
 * some environments ship no `.git` directory at all. CI environment variables
 * are therefore the primary source, with git used only to fill gaps.
 *
 * Resolution order:
 *   1. INLINE_EDIT_BRANCH / INLINE_EDIT_COMMIT / INLINE_EDIT_REPO (manual override)
 *   2. The detected CI provider's variables
 *   3. git, per missing field
 */

/** Providers in detection order. `repo` is always "owner/name" or null. */
const PROVIDERS = [
  {
    name: 'vercel',
    detect: (e) => e.VERCEL === '1' || Boolean(e.VERCEL_GIT_COMMIT_REF),
    branch: (e) => e.VERCEL_GIT_COMMIT_REF,
    commit: (e) => e.VERCEL_GIT_COMMIT_SHA,
    repo: (e) =>
      e.VERCEL_GIT_REPO_OWNER && e.VERCEL_GIT_REPO_SLUG
        ? `${e.VERCEL_GIT_REPO_OWNER}/${e.VERCEL_GIT_REPO_SLUG}`
        : null,
  },
  {
    name: 'netlify',
    detect: (e) => e.NETLIFY === 'true' || Boolean(e.COMMIT_REF),
    branch: (e) => e.BRANCH,
    commit: (e) => e.COMMIT_REF,
    repo: (e) => parseRepoUrl(e.REPOSITORY_URL),
  },
  {
    name: 'github-actions',
    detect: (e) => e.GITHUB_ACTIONS === 'true',
    // GITHUB_REF_NAME is "123/merge" on pull_request events; GITHUB_HEAD_REF
    // carries the actual source branch there and is empty otherwise.
    branch: (e) => e.GITHUB_HEAD_REF || e.GITHUB_REF_NAME,
    commit: (e) => e.GITHUB_SHA,
    repo: (e) => e.GITHUB_REPOSITORY,
  },
  {
    name: 'amplify',
    detect: (e) => Boolean(e.AWS_APP_ID || e.AWS_BRANCH),
    branch: (e) => e.AWS_BRANCH,
    commit: (e) => e.AWS_COMMIT_ID,
    repo: () => null, // Amplify exposes no repository variable
  },
  {
    name: 'cloudflare-pages',
    detect: (e) => e.CF_PAGES === '1' || Boolean(e.CF_PAGES_BRANCH),
    branch: (e) => e.CF_PAGES_BRANCH,
    commit: (e) => e.CF_PAGES_COMMIT_SHA,
    repo: () => null,
  },
  {
    name: 'render',
    detect: (e) => Boolean(e.RENDER || e.RENDER_GIT_BRANCH),
    branch: (e) => e.RENDER_GIT_BRANCH,
    commit: (e) => e.RENDER_GIT_COMMIT,
    repo: (e) =>
      e.RENDER_GIT_REPO_SLUG && e.RENDER_GIT_REPO_OWNER
        ? `${e.RENDER_GIT_REPO_OWNER}/${e.RENDER_GIT_REPO_SLUG}`
        : null,
  },
];

/**
 * Extract "owner/name" from any common git remote URL form.
 * Handles https://, ssh://, and scp-style git@host:owner/name.git
 */
function parseRepoUrl(url) {
  if (!url) return null;
  const m = /(?:[:/])([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Run a git command, returning null on any failure. */
function git(args) {
  try {
    const { execSync } = require('child_process');
    const out = execSync(`git ${args}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** Git fallbacks. `branch` is null on a detached HEAD rather than "HEAD". */
const gitFallback = {
  branch: () => {
    const b = git('rev-parse --abbrev-ref HEAD');
    return b === 'HEAD' ? null : b;
  },
  commit: () => git('rev-parse HEAD'),
  repo: () => parseRepoUrl(git('remote get-url origin')),
};

function firstNonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * @param {object} env  environment variables (injectable for testing)
 * @param {object} fb   per-field fallbacks (injectable for testing)
 * @returns {{branch: string|null, commit: string|null, repo: string|null, provider: string}}
 */
function resolveBuildInfo(env = process.env, fb = gitFallback) {
  const provider = PROVIDERS.find((p) => p.detect(env));

  const info = {
    branch:
      firstNonEmpty(env.INLINE_EDIT_BRANCH) ||
      (provider ? firstNonEmpty(provider.branch(env)) : null),
    commit:
      firstNonEmpty(env.INLINE_EDIT_COMMIT) ||
      (provider ? firstNonEmpty(provider.commit(env)) : null),
    repo:
      firstNonEmpty(env.INLINE_EDIT_REPO) ||
      (provider ? firstNonEmpty(provider.repo(env)) : null),
    provider: provider ? provider.name : 'local',
  };

  // Only shell out to git for the fields CI did not supply.
  for (const field of ['branch', 'commit', 'repo']) {
    if (!info[field]) info[field] = firstNonEmpty(fb[field]()) || null;
  }

  return info;
}

let _cached = null;

/** Memoised resolution against the real environment. */
function getBuildInfo() {
  if (_cached === null) _cached = resolveBuildInfo();
  return _cached;
}

/**
 * Whether annotation should run.
 *
 * INLINE_EDIT is the explicit switch, and is what preview deployments set —
 * they build with NODE_ENV=production, so the dev heuristic alone would never
 * fire there. When the flag is unset each plugin's own dev signal decides, so
 * local development keeps working with no configuration.
 *
 * @param {boolean} devSignal  the caller's notion of "this is a dev build"
 * @param {object}  env
 */
function isAnnotationEnabled(devSignal, env = process.env) {
  const flag = env.INLINE_EDIT;
  if (flag !== undefined && flag !== '') {
    const v = String(flag).toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  }
  return Boolean(devSignal);
}

/** The data-edit-* attributes describing this build, as an object. */
function buildInfoAttrs(info = getBuildInfo()) {
  const attrs = {};
  if (info.branch) attrs['data-edit-branch'] = info.branch;
  if (info.commit) attrs['data-edit-commit'] = info.commit;
  if (info.repo) attrs['data-edit-repo'] = info.repo;
  return attrs;
}

/** The same attributes rendered for injection into an HTML string. */
function buildInfoAttrString(info = getBuildInfo()) {
  return Object.entries(buildInfoAttrs(info))
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join('');
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Stamp the build attributes onto the <html> tag of an HTML document. */
function stampHtmlTag(html, info = getBuildInfo()) {
  const attrs = buildInfoAttrString(info);
  if (!attrs) return html;
  return html.replace(/(<html\b[^>]*?)(\s*\/?>)/i, (m, open, close) =>
    open.includes('data-edit-branch') ? m : `${open}${attrs}${close}`
  );
}

module.exports = {
  resolveBuildInfo,
  getBuildInfo,
  isAnnotationEnabled,
  buildInfoAttrs,
  buildInfoAttrString,
  stampHtmlTag,
  parseRepoUrl,
  PROVIDERS,
};
