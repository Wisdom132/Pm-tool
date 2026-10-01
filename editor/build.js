'use strict';

// ============================================================
//  Copy the built extension into this package
//
//  Runs on `prepack`, so `npm publish` cannot ship a stale or
//  empty `dist` — the thing that made @usecaliper/annotation
//  1.0.0 unusable was a file that existed in the repository and
//  not in the tarball, and the fix for that class of bug is to
//  build at pack time rather than hope.
// ============================================================

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const here = __dirname;
const extensionDir = path.resolve(here, '../inline-edit-tool/extension');
const sourceDist = path.join(extensionDir, 'dist');
const targetDist = path.join(here, 'dist');

/**
 * Only what a page needs.
 *
 * The extension's `dist` also holds `manifest.json`, the popup and the side
 * panel — all meaningless outside Chrome's extension host. Copying the whole
 * directory would put a manifest in people's `node_modules` claiming to be
 * an installable extension, which it is not.
 */
const SERVED = ['content.js', 'code-editor.js', 'page.css'];

function build() {
  if (!fs.existsSync(path.join(sourceDist, 'content.js'))) {
    console.log('[editor] extension not built yet — building it first');
    execFileSync('node', ['build.js'], { cwd: extensionDir, stdio: 'inherit' });
  }

  fs.rmSync(targetDist, { recursive: true, force: true });
  fs.mkdirSync(targetDist, { recursive: true });

  const missing = [];
  for (const name of SERVED) {
    const from = path.join(sourceDist, name);
    if (!fs.existsSync(from)) {
      missing.push(name);
      continue;
    }
    fs.copyFileSync(from, path.join(targetDist, name));
  }

  // Loud, and a non-zero exit: a half-built package publishes perfectly
  // happily and then 404s one asset at a time in somebody else's browser.
  if (missing.length) {
    console.error(`[editor] missing from the extension build: ${missing.join(', ')}`);
    process.exit(1);
  }

  const total = SERVED.reduce((n, f) => n + fs.statSync(path.join(targetDist, f)).size, 0);
  console.log(`[editor] ${SERVED.length} files, ${(total / 1024).toFixed(0)} KB → editor/dist`);
}

build();
