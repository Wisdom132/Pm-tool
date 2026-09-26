"use strict";

// ============================================================
//  Page context — which repo / branch / commit produced this page?
//
//  Pure functions with no DOM or chrome.* access so they can be
//  unit tested directly.
// ============================================================

/**
 * Infer a branch name from a preview-deploy hostname.
 *
 * These are a fallback only. Build hosts sanitise branch names into
 * hostnames ("feature/pricing" becomes "feature-pricing"), so the result may
 * not round-trip to a real ref — `data-edit-branch` from the annotation
 * plugin is always preferred when present.
 *
 * @param {string} hostname
 * @returns {string|null}
 */
export function detectBranchFromHostname(hostname) {
  if (!hostname) return null;

  // AWS Amplify: [branch].[app-id].amplifyapp.com
  const amplify = hostname.match(/^([^.]+)\.[^.]+\.amplifyapp\.com$/);
  if (amplify) return amplify[1];

  // Netlify: [branch]--[site-name].netlify.app
  if (hostname.endsWith(".netlify.app")) {
    const sub = hostname.split(".")[0];
    const idx = sub.indexOf("--");
    if (idx > 0) return sub.slice(0, idx);
  }

  // Vercel preview: [project]-git-[branch]-[team].vercel.app
  const vercel = hostname.match(/^.+-git-(.+)-[^.]+\.vercel\.app$/);
  if (vercel) return vercel[1];

  return null;
}

/** Read the build attributes the annotation plugin stamped onto <html>. */
export function readBuildAttrs(dataset = {}) {
  const clean = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  return {
    branch: clean(dataset.editBranch),
    commit: clean(dataset.editCommit),
    repo: clean(dataset.editRepo),
  };
}

/**
 * Resolve everything known about the build behind the current page.
 *
 * @param {{dataset?: object, hostname?: string}} input
 * @returns {{
 *   repo: string|null,
 *   branch: string|null,
 *   commit: string|null,
 *   repoSource: 'build'|null,
 *   branchSource: 'build'|'url'|null,
 *   complete: boolean
 * }}
 */
export function resolvePageContext({ dataset = {}, hostname = "" } = {}) {
  const attrs = readBuildAttrs(dataset);

  const fromUrl = attrs.branch ? null : detectBranchFromHostname(hostname);
  const branch = attrs.branch || fromUrl;

  return {
    repo: attrs.repo,
    branch,
    commit: attrs.commit,
    repoSource: attrs.repo ? "build" : null,
    branchSource: attrs.branch ? "build" : fromUrl ? "url" : null,
    // Both identifiers known — the pickers can be collapsed to a confirmation.
    complete: Boolean(attrs.repo && branch),
  };
}

/** Human-readable provenance for the summary row. */
export function describeSource(source) {
  if (source === "build") return "from build";
  if (source === "url") return "from URL";
  return null;
}
