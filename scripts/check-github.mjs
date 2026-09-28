#!/usr/bin/env node
/**
 * Prove the GitHub App credentials work, before the browser is involved.
 *
 * check-env only confirms the values are present and the key parses. This
 * signs a real App JWT and asks GitHub who it belongs to, which is the only
 * way to catch an App ID paired with someone else's key — a mismatch that
 * otherwise surfaces as a 401 halfway through opening a pull request.
 *
 * Usage: node scripts/check-github.mjs
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const API = resolve(here, '../apps/api');

// Load .env by hand: this runs outside Nest, which would normally do it.
const raw = await readFile(resolve(API, '.env'), 'utf8');
for (const line of raw.split('\n')) {
  const match = /^\s*([A-Z_0-9]+)\s*=\s*(.*)$/.exec(line);
  if (match && match[2].trim() && match[2].trim() !== 'TODO') {
    process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
}

// The compiled build, so this exercises the same code the API runs —
// including the CommonJS interop with ESM-only @babel/parser.
const { createAppJwt } = await import(resolve(API, 'dist/providers/github/app-jwt.js'));

console.log('');

let appJwt;
try {
  appJwt = await createAppJwt();
  console.log('  ✓ signed an App JWT');
} catch (err) {
  console.error(`  ✗ could not sign an App JWT: ${err.message}\n`);
  process.exit(1);
}

// GET /app identifies the app the JWT was signed for.
const appRes = await fetch('https://api.github.com/app', {
  headers: {
    Authorization: `Bearer ${appJwt}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'inline-edit-tool',
  },
});

if (!appRes.ok) {
  const body = await appRes.json().catch(() => ({}));
  console.error(`  ✗ GitHub rejected the JWT: ${appRes.status} ${body.message || ''}`);
  console.error('\n  Most likely the App ID and the private key belong to different apps,');
  console.error('  or the key was regenerated after this one was downloaded.\n');
  process.exit(1);
}

const app = await appRes.json();
console.log(`  ✓ GitHub recognises it: ${app.name} (app id ${app.id})`);

const perms = app.permissions || {};
const NEEDED = { contents: 'write', pull_requests: 'write', issues: 'write' };
let permissionsOk = true;

for (const [name, level] of Object.entries(NEEDED)) {
  const granted = perms[name];
  const ok = granted === level;
  if (!ok) permissionsOk = false;
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(14)} ${granted || 'not granted'}${ok ? '' : ` — needs ${level}`}`);
}

// Installations decide which repositories are editable at all.
const installRes = await fetch('https://api.github.com/app/installations', {
  headers: {
    Authorization: `Bearer ${appJwt}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'inline-edit-tool',
  },
});

const installations = installRes.ok ? await installRes.json() : [];

if (installations.length === 0) {
  console.log('\n  ✗ the app is not installed anywhere');
  console.log('    Install App in the sidebar, then pick your repositories.');
  console.log('    Until then the repository picker comes back empty.\n');
  process.exit(1);
}

console.log('');
for (const installation of installations) {
  const scope =
    installation.repository_selection === 'all' ? 'all repositories' : 'selected repositories';
  const kind = installation.account?.type === 'Organization' ? 'org ' : 'user';
  console.log(`  ✓ ${kind}  ${installation.account?.login.padEnd(20)} ${scope}`);
}

const hasOrg = installations.some((i) => i.account?.type === 'Organization');
if (!hasOrg) {
  console.log('\n  No organisation installations. To edit an org\'s repositories the app');
  console.log('  has to be installed on that organisation as well as on your account:');
  console.log(`    https://github.com/settings/apps/${app.slug}/installations`);
  console.log('  If "Install" offers no organisations, the app is restricted to its owner —');
  console.log('  change "Where can this GitHub App be installed?" to "Any account" under');
  console.log(`    https://github.com/settings/apps/${app.slug}`);
}

if (!permissionsOk) {
  console.error('\n  Fix the permissions on the app, then accept the request under');
  console.error('  Install App → the installation → Review request.\n');
  process.exit(1);
}

console.log('\n  Credentials are good. Start the service: npm run dev:api\n');
