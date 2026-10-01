"use strict";

// ============================================================
//  Which plugin built this page
//
//  The two halves of this product update at completely
//  different speeds. The extension auto-updates through the
//  Chrome Web Store; the build plugin only moves when somebody
//  runs `npm update` *and* redeploys. So the extension is
//  almost always the newer of the two, and it has to keep
//  working against every attribute set the plugin has ever
//  emitted.
//
//  Nothing here gates behaviour on a version — that is
//  `annotation/CONTRACT.md` rule 2, and breaking it would make
//  old pages stop working the day we shipped an extension
//  update. Features are detected by looking for the attribute.
//
//  What this is for is *explaining*. Without it, an edit that
//  fails because the plugin predates the feature looks exactly
//  like a page that was never annotated, and nobody can tell
//  that `npm update` is the fix.
// ============================================================

/** Feature → the plugin version that introduced it. */
export const FEATURE_SINCE = {
  /** Translated copy, redirected into a locale file. */
  i18n: "1.0.0",
  /** Provenance on elements the codemod cannot rewrite. */
  provenance: "1.0.0",
};

/**
 * Compare two dotted versions.
 *
 * @returns {number} negative when `a` is older, 0 when equal
 */
export function compareVersions(a, b) {
  const parts = (v) =>
    String(v ?? "")
      .split("-")[0]
      .split(".")
      .map((n) => Number(n) || 0);

  const left = parts(a);
  const right = parts(b);

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Does the page's plugin support this feature?
 *
 * An unknown version — a page built before `data-edit-version` existed —
 * answers `true`. Being wrong in that direction costs a hint that was not
 * needed; being wrong the other way tells somebody their plugin is too old
 * when it is not, and sends them to update something that was fine.
 */
export function pluginSupports(pageVersion, feature) {
  const since = FEATURE_SINCE[feature];
  if (!since || !pageVersion) return true;
  return compareVersions(pageVersion, since) >= 0;
}

/**
 * One sentence explaining a missing feature, or null when there is nothing
 * to say.
 *
 * Deliberately names the fix. "Not supported" is a dead end; "needs 1.2,
 * this page has 1.0" is something somebody can act on without asking us.
 */
export function outdatedHint(pageVersion, feature) {
  if (!pageVersion || pluginSupports(pageVersion, feature)) return null;

  return (
    `This page was built with the annotation plugin ${pageVersion}. ` +
    `That needs ${FEATURE_SINCE[feature]} or newer — run npm update in the site's repository and redeploy.`
  );
}
