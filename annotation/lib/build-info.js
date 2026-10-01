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
 * What the host says this deployment is: 'production', 'preview', or null
 * when we do not recognise the host.
 *
 * Every one of these is the host's own variable, documented by it. Guessing
 * from a branch name was considered and rejected — plenty of teams deploy
 * production from something other than `main`, and being wrong in that
 * direction publishes their source layout.
 */
function hostDeployKind(env = process.env) {
  // Vercel: 'production' | 'preview' | 'development'
  if (env.VERCEL_ENV) return env.VERCEL_ENV === 'production' ? 'production' : 'preview';

  // Netlify: 'production' | 'deploy-preview' | 'branch-deploy' | 'dev'
  if (env.CONTEXT) return env.CONTEXT === 'production' ? 'production' : 'preview';

  // Cloudflare Pages names the production branch, so a build of any other
  // branch is a preview.
  if (env.CF_PAGES_BRANCH && env.CF_PAGES_BRANCH !== env.CF_PAGES_PRODUCTION_BRANCH) {
    return env.CF_PAGES_PRODUCTION_BRANCH ? 'preview' : null;
  }

  // Render: 'production' | 'preview'
  if (env.IS_PULL_REQUEST === 'true') return 'preview';

  // Amplify sets the branch but says nothing about its role, and GitHub
  // Actions builds are not deployments. Neither can answer this.
  return null;
}

/**
 * Whether annotation should run.
 *
 * Three rules, in this order, and the order is the safety property:
 *
 * 1. **`INLINE_EDIT` wins, both ways.** An explicit `0` turns annotation off
 *    even on a preview deploy, which is the only way to opt a sensitive
 *    branch out.
 * 2. **A host that calls this production is obeyed.** Nothing below may
 *    turn annotation on after that. Annotations name every source file on
 *    the page, and publishing a company's directory structure because a
 *    heuristic misfired is not a recoverable mistake.
 * 3. **Otherwise: preview deploys and dev builds are annotated**, and
 *    everything else is not.
 *
 * Rule 3 is the change that makes this usable. Previously a preview deploy
 * built with NODE_ENV=production and no flag, so the dev signal never fired
 * and the deploy an editor was pointed at had no annotations at all — the
 * most common way for this product to appear broken, and one that required
 * reading the plugin source to diagnose.
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

  const kind = hostDeployKind(env);
  if (kind === 'production') return false;
  if (kind === 'preview') return true;

  // Anything else — an unrecognised host, a bare `node` process — stays
  // off unless its own dev signal says otherwise. `NODE_ENV !== 'production'`
  // was tried here and removed: it is true in a test runner, in a CI job,
  // and in any process that never set it, so it turned annotation on in
  // places nobody was deploying from. Off-by-default is the only safe
  // answer when we cannot tell what a build is for.
  return Boolean(devSignal);
}

/**
 * Which version of this package stamped the page.
 *
 * Read from our own package.json rather than hard-coded, so it cannot drift
 * from what was actually published.
 */
function pluginVersion() {
  if (_version !== null) return _version;
  try {
    _version = require('../package.json').version || null;
  } catch {
    // Bundled somewhere that cannot resolve the manifest. A missing version
    // is readable as "older than any version that reports one", which is
    // the right default.
    _version = null;
  }
  return _version;
}
let _version = null;

/**
 * The data-edit-* attributes describing this build, as an object.
 *
 * `data-edit-version` is here for diagnostics, never for branching. The
 * extension auto-updates through the Chrome Web Store; this package only
 * updates when somebody runs `npm update` *and* redeploys. So the extension
 * is almost always the newer of the two, and it has to keep working against
 * every attribute set this package has ever emitted.
 *
 * What the version buys is the ability to say so. Without it, an edit that
 * fails because the plugin predates the feature looks identical to a page
 * that was never annotated — and nobody can tell that `npm update` is the
 * fix.
 */
function buildInfoAttrs(info = getBuildInfo()) {
  const attrs = {};
  if (info.branch) attrs['data-edit-branch'] = info.branch;
  if (info.commit) attrs['data-edit-commit'] = info.commit;
  if (info.repo) attrs['data-edit-repo'] = info.repo;

  const version = pluginVersion();
  if (version) attrs['data-edit-version'] = version;

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
    // Checked against any of our attributes, not just the branch: a local
    // build has no branch variable, so keying on it alone made this
    // non-idempotent exactly where it is run most often.
    /data-edit-(branch|commit|repo|version)=/.test(open) ? m : `${open}${attrs}${close}`
  );
}

module.exports = {
  resolveBuildInfo,
  pluginVersion,
  getBuildInfo,
  isAnnotationEnabled,
  hostDeployKind,
  buildInfoAttrs,
  buildInfoAttrString,
  stampHtmlTag,
  parseRepoUrl,
  PROVIDERS,
};
