'use strict';

// ============================================================
//  esbuild build script for the Chrome extension
//  Usage:
//    node build.js          — production build → dist/
//    node build.js --watch  — rebuild on file changes
// ============================================================

const esbuild = require('esbuild');
const fs      = require('fs');
const path    = require('path');

const WATCH   = process.argv.includes('--watch');
const OUT_DIR = path.join(__dirname, 'dist');

// Static files to copy as-is
// ui.css is not listed: it is bundled into content.js as a string and
// injected into the shadow root.
const STATIC = ['manifest.json', 'page.css', 'popup.html', 'sidepanel.html'];

/**
 * Clear dist before a fresh build.
 *
 * Without this, a file that is renamed or dropped from STATIC stays behind
 * and gets packaged with the extension — dist/overlay.css outlived the split
 * into page.css and ui.css exactly that way.
 */
function cleanOutDir() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
}

function copyStatics() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const file of STATIC) {
    fs.copyFileSync(
      path.join(__dirname, file),
      path.join(OUT_DIR, file)
    );
  }
}

/** esbuild config shared by all entry points */
const BASE = {
  bundle:   true,
  format:   'iife',
  platform: 'browser',
  target:   'chrome120',
  outdir:   OUT_DIR,
  logLevel: 'info',
  // UI styles are imported as a string and injected into the shadow root.
  loader:   { '.css': 'text' },
};

async function build() {
  if (!WATCH) cleanOutDir();
  copyStatics();

  if (WATCH) {
    const ctx = await esbuild.context({
      ...BASE,
      entryPoints: {
        content:    'src/content.js',
        background: 'src/background.js',
        popup:      'src/popup.js',
        sidepanel:  'src/sidepanel.js',
      },
      // Rebuild statics on each change too
      plugins: [
        {
          name: 'copy-statics',
          setup(build) {
            build.onEnd(() => copyStatics());
          },
        },
      ],
    });

    await ctx.watch();
    console.log('[inline-edit-tool] Watching for changes — dist/ will update automatically.');
  } else {
    await esbuild.build({
      ...BASE,
      entryPoints: {
        content:    'src/content.js',
        background: 'src/background.js',
        popup:      'src/popup.js',
        sidepanel:  'src/sidepanel.js',
      },
      minify: false,
    });

    console.log('[inline-edit-tool] Build complete \u2192 dist/');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
