#!/usr/bin/env node
/**
 * Pre-flight the built extension before loading it into Chrome.
 *
 * Chrome's own errors for a malformed extension are terse and point at the
 * manifest rather than the cause, so the cheap checks are done here: every
 * file the manifest names exists, every chrome.* API used is permitted, and
 * every script an HTML page loads was actually built.
 *
 * Usage: node scripts/check-extension.mjs
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(here, '../inline-edit-tool/extension/dist');

const problems = [];
const notes = [];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(DIST))) {
  console.error('No dist/ directory. Run: npm run build:ext');
  process.exit(1);
}

// ---- manifest ------------------------------------------------------------
let manifest;
try {
  manifest = JSON.parse(await readFile(resolve(DIST, 'manifest.json'), 'utf8'));
} catch (err) {
  console.error(`manifest.json is not valid JSON: ${err.message}`);
  process.exit(1);
}

if (manifest.manifest_version !== 3) {
  problems.push(`manifest_version is ${manifest.manifest_version}, expected 3`);
}

// ---- every referenced file must exist ------------------------------------
const referenced = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.side_panel?.default_path,
  ...(manifest.content_scripts || []).flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
].filter(Boolean);

for (const file of referenced) {
  if (!(await exists(resolve(DIST, file)))) {
    problems.push(`manifest references ${file}, which is not in dist/`);
  }
}

// ---- scripts and styles loaded by HTML pages ------------------------------
for (const page of [manifest.action?.default_popup, manifest.side_panel?.default_path].filter(
  Boolean
)) {
  const html = await readFile(resolve(DIST, page), 'utf8');
  for (const [, src] of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    if (!(await exists(resolve(DIST, src)))) {
      problems.push(`${page} loads ${src}, which is not in dist/`);
    }
  }
  for (const [, href] of html.matchAll(/<link[^>]+href="([^"]+)"/g)) {
    if (href.startsWith('http')) continue;
    if (!(await exists(resolve(DIST, href)))) {
      problems.push(`${page} loads ${href}, which is not in dist/`);
    }
  }
}

// ---- chrome.* APIs used vs permissions granted ---------------------------
const PERMISSION_FOR = {
  'chrome.storage': 'storage',
  'chrome.identity': 'identity',
  'chrome.tabs': 'tabs',
  'chrome.windows': 'windows',
  'chrome.sidePanel': 'sidePanel',
  'chrome.scripting': 'scripting',
};

const bundles = (await readdir(DIST)).filter((f) => f.endsWith('.js'));
const used = new Set();

for (const file of bundles) {
  const code = await readFile(resolve(DIST, file), 'utf8');
  for (const api of Object.keys(PERMISSION_FOR)) {
    // Optional chaining (`chrome.sidePanel?.setPanelBehavior`) is still a use.
    if (code.includes(`${api}.`) || code.includes(`${api}?.`)) used.add(api);
  }
}

const granted = new Set(manifest.permissions || []);

for (const api of used) {
  const permission = PERMISSION_FOR[api];
  if (!granted.has(permission)) {
    problems.push(`${api} is used but "${permission}" is not in permissions`);
  }
}

for (const permission of granted) {
  const api = Object.entries(PERMISSION_FOR).find(([, p]) => p === permission)?.[0];
  // activeTab has no direct API surface; it gates host access.
  if (api && !used.has(api) && permission !== 'activeTab') {
    notes.push(`"${permission}" is requested but ${api} is never called`);
  }
}

// ---- annotations must not be in a shipped build --------------------------
for (const file of bundles) {
  const code = await readFile(resolve(DIST, file), 'utf8');
  // Not preceded by `[`: content.js legitimately builds the selector
  // `[data-edit-file="…"]` to find an element by its source file. What must
  // never ship is an annotation *stamped into markup*, which has no bracket.
  if (/(^|[^[])data-edit-file="/.test(code)) {
    problems.push(`${file} contains literal annotations`);
  }
}

// ---- report --------------------------------------------------------------
console.log(`\n  ${manifest.name} v${manifest.version}`);
console.log(`  ${DIST}\n`);
console.log(`  files      ${(await readdir(DIST)).length}`);
console.log(`  permissions ${[...granted].join(', ')}`);
console.log(`  chrome APIs ${[...used].sort().join(', ')}\n`);

for (const note of notes) console.log(`  note: ${note}`);

if (problems.length > 0) {
  console.error(`\n  ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`    ✗ ${problem}`);
  console.error('');
  process.exit(1);
}

console.log('  Ready to load: chrome://extensions → Developer mode → Load unpacked\n');
