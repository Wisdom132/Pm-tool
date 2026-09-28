#!/usr/bin/env node
/**
 * Put a GitHub App private key into apps/api/.env.
 *
 * Doing this by hand goes wrong in predictable ways: the key is multi-line so
 * a plain copy breaks the file, `>>` appends a second definition instead of
 * replacing the placeholder, and a typo'd filename silently writes nothing.
 * This finds the file, checks it really is a key, base64-encodes it onto one
 * line, and replaces the existing value.
 *
 * Usage:
 *   node scripts/install-app-key.mjs                  # searches ~/Downloads
 *   node scripts/install-app-key.mjs path/to/key.pem
 */

import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createPrivateKey } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = resolve(here, '../apps/api/.env');

/** GitHub names the download <app-name>.<date>.private-key.pem */
async function findCandidates() {
  const dirs = [join(homedir(), 'Downloads'), join(homedir(), 'Desktop'), process.cwd()];
  const found = [];

  for (const dir of dirs) {
    try {
      for (const name of await readdir(dir)) {
        if (!name.endsWith('.pem')) continue;
        const path = join(dir, name);
        found.push({ path, mtime: (await stat(path)).mtimeMs });
      }
    } catch {
      // Directory missing or unreadable — just not a source of candidates.
    }
  }

  return found.sort((a, b) => b.mtime - a.mtime).map((f) => f.path);
}

let keyPath = process.argv[2];

if (!keyPath) {
  const candidates = await findCandidates();

  if (candidates.length === 0) {
    console.error('\n  No .pem file found in ~/Downloads, ~/Desktop or the current directory.\n');
    console.error('  Generate one first:');
    console.error('    https://github.com/settings/apps → your app → Generate a private key\n');
    console.error('  Then re-run this, or pass the path:');
    console.error('    npm run install:key -- /path/to/key.pem\n');
    process.exit(1);
  }

  keyPath = candidates[0]; // most recently modified
  if (candidates.length > 1) {
    console.log(`\n  Found ${candidates.length} .pem files; using the newest:`);
    for (const path of candidates) console.log(`    ${path === keyPath ? '→' : ' '} ${path}`);
  }
}

// ---- read and validate ---------------------------------------------------
let pem;
try {
  pem = await readFile(keyPath, 'utf8');
} catch (err) {
  console.error(`\n  Could not read ${keyPath}: ${err.message}\n`);
  process.exit(1);
}

try {
  createPrivateKey(pem);
} catch (err) {
  console.error(`\n  ${keyPath} is not a usable private key: ${err.message}`);
  console.error('  Download it again from the app\'s settings page.\n');
  process.exit(1);
}

// ---- write ---------------------------------------------------------------
let env;
try {
  env = await readFile(ENV_FILE, 'utf8');
} catch {
  console.error(`\n  No .env at ${ENV_FILE}\n`);
  process.exit(1);
}

const encoded = Buffer.from(pem, 'utf8').toString('base64');
const line = `GITHUB_APP_PRIVATE_KEY=${encoded}`;

// Replace every existing definition rather than adding another — a duplicate
// key silently shadows the one above it.
const pattern = /^GITHUB_APP_PRIVATE_KEY=.*$/gm;
const updated = pattern.test(env) ? env.replace(pattern, line) : `${env.trimEnd()}\n${line}\n`;

await writeFile(ENV_FILE, updated);

console.log(`\n  Key installed from ${keyPath}`);
console.log(`  ${encoded.length} characters, base64 on one line\n`);
console.log('  Check the rest with: npm run check:env\n');
