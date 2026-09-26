#!/usr/bin/env node
/**
 * Fail if a production bundle contains inline-edit annotations.
 *
 * `data-edit-file` exposes the repository's source-file layout to anyone
 * viewing the page, so annotations belong in preview deployments only. Run
 * this against a production build directory as the last step of a release.
 *
 * Usage: node scripts/check-no-annotations.mjs <dir> [<dir>...]
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const MARKERS = ['data-edit-file', 'data-edit-editable', 'data-editable="true"'];
const SCANNED_EXTS = new Set(['.html', '.htm', '.js', '.mjs', '.cjs', '.css', '.json', '.txt']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.cache']);

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Cannot read ${dir}: ${err.message}`);
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (SCANNED_EXTS.has(extname(entry.name))) {
      yield full;
    }
  }
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('usage: check-no-annotations.mjs <dir> [<dir>...]');
  process.exit(2);
}

const offenders = [];
let scanned = 0;

for (const target of targets) {
  try {
    await stat(target);
  } catch {
    console.error(`error: no such directory: ${target}`);
    process.exit(2);
  }

  for await (const file of walk(target)) {
    scanned++;
    const content = await readFile(file, 'utf8');
    const hits = MARKERS.filter((m) => content.includes(m));
    if (hits.length > 0) offenders.push({ file, hits });
  }
}

if (offenders.length > 0) {
  console.error(
    `\nInline-edit annotations found in ${offenders.length} of ${scanned} scanned file(s).\n` +
      `These leak source paths and must not ship to production.\n` +
      `Build without INLINE_EDIT set (or with INLINE_EDIT=0).\n`
  );
  for (const { file, hits } of offenders) {
    console.error(`  ${file} — ${hits.join(', ')}`);
  }
  process.exit(1);
}

console.log(`No inline-edit annotations in ${scanned} scanned file(s).`);
