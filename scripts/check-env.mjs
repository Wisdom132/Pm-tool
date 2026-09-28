#!/usr/bin/env node
/**
 * Report what the pr-service is still missing.
 *
 * Misconfiguration otherwise surfaces as an opaque failure several steps
 * later — a blank OAuth page, or a 500 when a pull request is submitted.
 * This says which value is absent and where to get it.
 *
 * Usage: node scripts/check-env.mjs
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = resolve(here, '../overlay/pr-service/.env.local');

let raw;
try {
  raw = await readFile(ENV_FILE, 'utf8');
} catch {
  console.error(`\n  No .env.local at ${ENV_FILE}`);
  console.error('  Copy overlay/pr-service/.env.example and fill it in.\n');
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
  ['GITHUB_APP_ID', 'the App ID at the top of your GitHub App settings page'],
  ['GITHUB_CLIENT_ID', 'the Client ID on the same page'],
  ['GITHUB_CLIENT_SECRET', 'press "Generate a new client secret"'],
  ['GITHUB_APP_PRIVATE_KEY', 'press "Generate a private key", then base64 the .pem'],
  ['APP_URL', 'must match the app\'s callback URL origin'],
  ['TOKEN_SECRET', 'openssl rand -base64 32'],
];

const missing = REQUIRED.filter(([key]) => !isSet(key));

console.log(`\n  ${ENV_FILE}\n`);

for (const [key, hint] of REQUIRED) {
  const ok = isSet(key);
  const shown = ok
    ? key.includes('SECRET') || key.includes('PRIVATE')
      ? `set (${env[key].length} chars)`
      : env[key]
    : `MISSING — ${hint}`;
  console.log(`  ${ok ? '✓' : '✗'} ${key.padEnd(24)} ${shown}`);
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
  ['ALLOWED_EXTENSION_IDS', 'any extension accepted outside production'],
  ['UPSTASH_REDIS_REST_URL', 'sessions held in memory — fine for one local server'],
  ['SENTRY_DSN', 'errors go to the structured logs only'],
];

for (const [key, consequence] of optional) {
  if (!isSet(key)) console.log(`  · ${key} unset — ${consequence}`);
}

if (missing.length > 0) {
  console.error(`\n  ${missing.length} value(s) still needed. See docs/DEPLOYMENT.md\n`);
  process.exit(1);
}

console.log('\n  Ready. Start the service with: npm run dev:svc\n');
