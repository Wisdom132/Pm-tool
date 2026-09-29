"use strict";

// ============================================================
//  Site resolution — "this page is on staging.acme.com, what am
//  I editing?"
//
//  This replaces reading `data-edit-repo` and `data-edit-branch`
//  off the page and sending them to the service.
//
//  The reason is not tidiness. Those attributes come from a page
//  we do not control, and the old service trusted them: any
//  editor could name any repository their organisation's
//  connection could reach, regardless of which sites their team
//  had been granted. The server now decides, from the site
//  registry, and the extension sends only an environment id.
//
//  The build annotation still matters — it carries the exact
//  commit the preview was built from, which is what keeps a
//  change request's diff to just these edits. It is a
//  *refinement* now rather than the source of truth.
// ============================================================

/** Answers are stable for a page view; re-resolving on every action is waste. */
const cache = new Map();

/**
 * @typedef {object} ResolvedSite
 * @property {boolean} known
 * @property {string|null} environmentId  what every editing call sends
 * @property {string|null} repository     for display only
 * @property {string|null} branch         null means "from the page"
 * @property {string|null} hostname
 * @property {boolean} verified
 * @property {string|null} reason         why not, when known is false
 */

/**
 * Ask the API what this hostname is.
 *
 * @param {(message: object) => Promise<any>} send  the background bridge
 * @param {{hostname: string, token: string, serviceUrl: string, force?: boolean}} options
 * @returns {Promise<ResolvedSite>}
 */
export async function resolveSite(send, { hostname, token, serviceUrl, force = false }) {
  const key = `${serviceUrl}|${hostname}`;
  if (!force && cache.has(key)) return cache.get(key);

  let result;
  try {
    const response = await send({
      type: "API_FETCH",
      payload: {
        path: `/api/resolve?hostname=${encodeURIComponent(hostname)}`,
        token,
        serviceUrl,
      },
    });

    if (response?.error) {
      result = unknown(response.error);
    } else if (response?.known) {
      result = {
        known: true,
        environmentId: response.environmentId,
        repository: response.repository ?? null,
        branch: response.branch ?? null,
        hostname: response.hostname ?? hostname,
        verified: Boolean(response.verified),
        reason: null,
      };
    } else {
      result = unknown(
        response?.reason ??
          `${hostname} is not registered. Add it in the dashboard to start editing.`
      );
    }
  } catch (err) {
    // A failure to reach us is not the same as "not registered", and telling
    // someone to register a site they already registered is worse than
    // saying the connection failed.
    result = unknown(`Could not reach the Inline Edit API: ${err.message}`);
  }

  // Only successes are cached. A transient failure should not pin the page
  // into an unusable state until reload.
  if (result.known) cache.set(key, result);
  return result;
}

function unknown(reason) {
  return {
    known: false,
    environmentId: null,
    repository: null,
    branch: null,
    hostname: null,
    verified: false,
    reason,
  };
}

/** After signing out, or switching service URL. */
export function clearSiteCache() {
  cache.clear();
}

/**
 * What to send with an editing request.
 *
 * `branch` is included *only* when the environment does not pin one — the
 * preview-deploy case, where the branch genuinely comes from the page. The
 * API ignores it otherwise, and sending it anyway would suggest the client
 * has a say that it does not.
 *
 * @param {ResolvedSite} site
 * @param {{branch: string|null, commit: string|null}} pageContext
 */
export function editingParams(site, pageContext = {}) {
  const params = { environmentId: site.environmentId };

  if (!site.branch && pageContext.branch) params.branch = pageContext.branch;
  if (pageContext.commit) params.buildCommit = pageContext.commit;

  return params;
}
