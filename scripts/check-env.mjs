#!/usr/bin/env node
/**
 * Report what the API is still missing.
 *
 * Misconfiguration otherwise surfaces as an opaque failure several steps
 * later — a blank install page, or a 500 when a change request is submitted.
 * This says which value is absent and where to get it.
 *
 * Usage: node scripts/check-env.mjs
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = resolve(here, '../apps/api/.env');

let raw;
try {
  raw = await readFile(ENV_FILE, 'utf8');
} catch {
  console.error(`\n  No .env at ${ENV_FILE}`);
  console.error('  Copy apps/api/.env.example and fill it in.\n');
  process.exit(1);
}

/** Minimal parser: KEY=value, ignoring comments and blanks. */
const env = {};
for (const line of raw.split('\n')) {
  const match = /^\s*([A-Z_0-9]+)\s*=\s*(.*)$/.exec(line);
  if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
}

const isSet = (key) => env[key] && env[key] !== 'TODO';

const REQUIRED = [
  ['DATABASE_URL', 'postgres://… — createdb inline_edit, then prisma migrate deploy'],
  ['CREDENTIALS_KEY', "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""],
  ['GITHUB_APP_ID', 'the App ID at the top of your GitHub App settings page'],
  ['GITHUB_APP_SLUG', 'the last path segment of github.com/apps/<slug>'],
  ['GITHUB_APP_PRIVATE_KEY', 'press "Generate a private key", then npm run install:key'],
];

const missing = REQUIRED.filter(([key]) => !isSet(key));

console.log(`\n  ${ENV_FILE}\n`);

for (const [key, hint] of REQUIRED) {
  const ok = isSet(key);
  const shown = ok
    ? key.includes('SECRET') || key.includes('PRIVATE') || key.includes('KEY') || key.includes('URL')
      ? `set (${env[key].length} chars)`
      : env[key]
    : `MISSING — ${hint}`;
  console.log(`  ${ok ? '✓' : '✗'} ${key.padEnd(24)} ${shown}`);
}

// The credential key is the one whose *shape* matters, not just presence:
// AES-256 needs exactly 32 bytes, and a short key fails at boot.
if (isSet('CREDENTIALS_KEY')) {
  const bytes = Buffer.from(env.CREDENTIALS_KEY.split(',')[0].trim(), 'base64').length;
  const ok = bytes === 32;
  console.log(`  ${ok ? '✓' : '✗'} ${'(credential key size)'.padEnd(24)} ${bytes} bytes${ok ? '' : ' — AES-256 needs 32'}`);
  if (!ok) missing.push(['CREDENTIALS_KEY', 'present but not 32 bytes once base64-decoded']);
}

// The private key is the value most likely to arrive mangled.
if (isSet('GITHUB_APP_PRIVATE_KEY')) {
  let pem = env.GITHUB_APP_PRIVATE_KEY;
  try {
    if (!pem.includes('BEGIN')) pem = Buffer.from(pem, 'base64').toString('utf8');
    pem = pem.replace(/\\n/g, '\n');
    createPrivateKey(pem);
    console.log(`  ✓ ${'(private key parses)'.padEnd(24)} RSA key loaded`);
  } catch (err) {
    console.log(`  ✗ ${'(private key parses)'.padEnd(24)} ${err.message}`);
    missing.push(['GITHUB_APP_PRIVATE_KEY', 'the value is present but not a usable PEM']);
  }
}

console.log('');

const optional = [
  ['DASHBOARD_URL', 'the install callback redirects to http://localhost:4200'],
  ['CORS_ORIGINS', 'only http://localhost:4300 may call the API'],
  ['SENTRY_DSN', 'errors go to the structured logs only'],
];

for (const [key, consequence] of optional) {
  if (!isSet(key)) console.log(`  · ${key} unset — ${consequence}`);
}

if (missing.length > 0) {
  console.error(`\n  ${missing.length} value(s) still needed. See docs/DEPLOYMENT.md\n`);
  process.exit(1);
}

console.log('\n  Ready. Start the API with: npm run dev:api\n');
