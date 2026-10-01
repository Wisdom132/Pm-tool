'use strict';

// ============================================================
//  Where the editor's files are
//
//  This package exists for one reason: `preview` used to need
//  an absolute filesystem path to a built extension, which is
//  a thing only the person who built it has. "Try Caliper
//  without installing the extension" was therefore false for
//  everybody except whoever was developing it.
//
//  It is deliberately a *separate* package from
//  `@usecaliper/annotation`. Two reasons, and the second is the
//  real one:
//
//  1. Size. The annotation plugins are 26 KB; the editor is
//     closer to 750 KB. Most people use the browser extension
//     and would be downloading it for nothing.
//
//  2. Version independence. CONTRACT.md's rule is that the
//     extension feature-detects and never version-gates, so a
//     site built with one version of the plugin works with an
//     editor released long before or after it. Shipping them in
//     one package would create exactly the lockstep that rule
//     exists to prevent — every plugin patch would drag an
//     editor release along behind it.
// ============================================================

const path = require('path');
const fs = require('fs');

/** The built editor, as copied in by `build.js`. */
const distDir = path.join(__dirname, 'dist');

/**
 * The files a dev server has to serve, by the URL the page asks for.
 *
 * `code-editor.js` is listed but not loaded up front — the page only pulls
 * it when somebody opens the source editor, which is why the cost of this
 * package in practice is the ~250 KB of `content.js`, not the full bundle.
 */
const assets = {
  '/__iet/content.js': { file: path.join(distDir, 'content.js'), type: 'text/javascript' },
  '/__iet/code-editor.js': { file: path.join(distDir, 'code-editor.js'), type: 'text/javascript' },
  '/__iet/page.css': { file: path.join(distDir, 'page.css'), type: 'text/css' },
};

/**
 * Is this package actually built?
 *
 * Published, `dist` is always present — `files` includes it and `prepack`
 * builds it. In a checkout it is absent until someone runs the extension
 * build, and saying so beats a stack trace about a missing file.
 */
function isBuilt() {
  return fs.existsSync(path.join(distDir, 'content.js'));
}

module.exports = { distDir, assets, isBuilt, version: require('./package.json').version };
