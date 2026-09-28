"use strict";

// ============================================================
//  Finding the stylesheets a component brings in
//
//  A component's styles are wherever it imports them from, so
//  the file itself is the index. This reads the import
//  statements rather than guessing at a naming convention:
//  a guess that is usually right is worse than nothing, because
//  it opens the wrong file without saying so.
// ============================================================

const STYLE_EXTENSIONS = /\.(css|scss|sass|less|styl|pcss)$/i;

/**
 * `import './hero.css'` and `import styles from './x.module.css'`, plus the
 * `@import` form that shows up inside stylesheets themselves.
 *
 * Deliberately a scan rather than a parse: these are declarations at the top
 * of a file, and shipping a JS parser to the content script to read them
 * would cost more than the feature.
 */
const IMPORT_PATTERNS = [
  /\bimport\s+[^'"]*from\s*['"]([^'"]+)['"]/g, // import x from './a.css'
  /\bimport\s*['"]([^'"]+)['"]/g, //              import './a.css'
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, //   require('./a.css')
  /@import\s+(?:url\()?\s*['"]([^'"]+)['"]/g, //  @import './a.css'
];

/** Is this a stylesheet rather than a module? */
export function isStylesheet(path) {
  return STYLE_EXTENSIONS.test(String(path).split("?")[0]);
}

/**
 * Resolve a relative specifier against the importing file.
 *
 * Returns null for anything that is not relative: a bare specifier is a
 * package, and `/styles/x.css` is served from a public directory that has no
 * fixed place in the repository. Opening a wrong path is worse than opening
 * nothing.
 */
export function resolveImportPath(specifier, fromFile) {
  if (!specifier.startsWith(".")) return null;

  const segments = String(fromFile).split("/").slice(0, -1);

  for (const part of specifier.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      if (segments.length === 0) return null; // escapes the repository root
      segments.pop();
      continue;
    }
    segments.push(part);
  }

  return segments.join("/");
}

/**
 * Every stylesheet a file imports, in the order it imports them.
 *
 * @param {string} content  the file's source
 * @param {string} filePath path of that file, used to resolve relatives
 * @returns {string[]} repository-relative paths, deduplicated
 */
export function stylesheetImports(content, filePath) {
  const found = [];

  for (const pattern of IMPORT_PATTERNS) {
    // Each call gets its own lastIndex; the literals above are shared.
    const scanner = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = scanner.exec(String(content))) !== null) {
      const specifier = match[1];
      if (!isStylesheet(specifier)) continue;

      const resolved = resolveImportPath(specifier, filePath);
      if (resolved && !found.includes(resolved)) found.push(resolved);
    }
  }

  return found;
}

/** Does this file carry its styles inside itself? */
export function hasEmbeddedStyles(content) {
  return /<style[\s>]/i.test(String(content));
}

/**
 * The CSS inside a single-file component's <style> blocks.
 *
 * Vue and Svelte keep styles in the component file, so there is no stylesheet
 * to open — but the rules are still CSS, and the browser can still run them.
 *
 * `scoped` cannot be reproduced: the compiler rewrites those selectors with a
 * per-component attribute that does not exist until build. The rules are
 * previewed unscoped, which is why the caller is told.
 *
 * @returns {{css: string, scoped: boolean}|null}
 */
export function extractEmbeddedStyles(content) {
  const blocks = [...String(content).matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/gi)];
  if (blocks.length === 0) return null;

  return {
    css: blocks.map((b) => b[2]).join("\n"),
    scoped: blocks.some((b) => /\bscoped\b/i.test(b[1])),
  };
}

/**
 * Is this a stylesheet the browser cannot run as-is?
 *
 * SCSS, Less and Stylus compile at build time. Their output is CSS, but the
 * source is not, so a live preview of one can only ever be partial.
 */
export function isPreprocessed(path) {
  return /\.(scss|sass|less|styl)$/i.test(String(path).split("?")[0]);
}

/**
 * Why there is nothing to show, in the user's terms.
 *
 * Utility-class frameworks keep the styling in the markup, and a single-file
 * component keeps it in the file already open, so an empty styles tab is the
 * expected answer in both cases rather than a failure — but only if it says
 * which it is.
 *
 * @param {Element} element the element whose source is open
 * @param {string}  filePath
 * @param {string}  [content] the file's source, for single-file components
 */
export function describeMissingStyles(element, filePath, content = "") {
  const classes = [...(element?.classList ?? [])].filter(
    (c) => !c.startsWith("__iet")
  );

  // Utility frameworks produce many short, structured class names. Several of
  // them on one element is a far better signal than sniffing for a config
  // file the page cannot see.
  const utilityish = classes.filter((c) => /^[a-z]+[-:[]/.test(c) || /^[a-z]{1,3}-\d/.test(c));

  // A single-file component's styles are in the tab already open.
  if (hasEmbeddedStyles(content)) {
    return {
      reason: "embedded",
      title: "Styles are in this file",
      detail:
        `${filePath.split("/").pop()} keeps its styles in a <style> block, so they are in the ` +
        `first tab rather than a file of their own. Editing them there previews on the page and ` +
        `commits with the rest of the component.`,
      classes,
    };
  }

  if (classes.length >= 3 && utilityish.length >= classes.length / 2) {
    return {
      reason: "utility-classes",
      title: "Styled with utility classes",
      detail:
        `${filePath.split("/").pop()} imports no stylesheet. This element's styling is in its ` +
        `class list, which you can edit in the markup tab or with the Properties tool.`,
      classes,
    };
  }

  return {
    reason: "no-import",
    title: "No stylesheet imported",
    detail:
      `${filePath.split("/").pop()} imports no CSS file, so there is nothing to open here. ` +
      `Styles applied from a global stylesheet or a CSS-in-JS library are not ` +
      `reachable from this file.`,
    classes,
  };
}
