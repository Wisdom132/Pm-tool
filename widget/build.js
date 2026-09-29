// ============================================================
//  Build the public feedback widget
//
//  Usage:
//    node build.js          — production build → dist/widget.js
//    node build.js --watch  — rebuild on change
//
//  One file, no dependencies, and small enough to sit on a
//  customer's marketing page without being something they have
//  to think about. Size is a feature here in a way it is not
//  for the extension: this loads on every page view of somebody
//  else's site.
// ============================================================

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The repository root is ESM, so there is no `__dirname` here.
const DIR = path.dirname(fileURLToPath(import.meta.url));

const WATCH = process.argv.includes('--watch');
const OUT_DIR = path.join(DIR, 'dist');

/**
 * A ceiling, enforced rather than hoped for.
 *
 * Widgets grow by a kilobyte at a time and nobody notices until a customer
 * does. If a change pushes past this, that is a conversation to have
 * deliberately — raise the number on purpose or find the weight.
 */
const MAX_BYTES = 24 * 1024;

const CONFIG = {
  entryPoints: { widget: path.join(DIR, 'src/widget.js') },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  // Wider than the extension's chrome120: this runs in whatever a
  // customer's visitors happen to be using.
  target: ['es2020', 'chrome90', 'firefox90', 'safari15'],
  outdir: OUT_DIR,
  minify: !WATCH,
  sourcemap: WATCH,
  logLevel: 'info',
};

async function build() {
  if (WATCH) {
    const ctx = await esbuild.context(CONFIG);
    await ctx.watch();
    console.log('[widget] Watching for changes.');
    return;
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  await esbuild.build(CONFIG);

  const bytes = fs.statSync(path.join(OUT_DIR, 'widget.js')).size;
  const kb = (bytes / 1024).toFixed(1);

  if (bytes > MAX_BYTES) {
    console.error(
      `[widget] ${kb}KB exceeds the ${(MAX_BYTES / 1024).toFixed(0)}KB budget. ` +
        'Find the weight, or raise the budget on purpose.',
    );
    process.exit(1);
  }

  // Also into the dashboard's static assets, because that is the origin the
  // embed snippet shown in the dashboard points at. Without this the snippet
  // is a lie: a customer pastes it and gets a 404.
  const dashboardPublic = path.join(DIR, '../apps/dashboard/public');
  if (fs.existsSync(dashboardPublic)) {
    fs.copyFileSync(path.join(OUT_DIR, 'widget.js'), path.join(dashboardPublic, 'widget.js'));
    console.log('[widget] Copied to apps/dashboard/public/widget.js');
  }

  console.log(`[widget] Build complete → dist/widget.js (${kb}KB)`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
