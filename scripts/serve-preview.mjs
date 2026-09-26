#!/usr/bin/env node
/**
 * Serve the extension directory so preview.html can load dist/content.js.
 *
 * The demo runs the shipped build against a stubbed chrome.* API, so this is
 * the fastest way to see the real editor without installing anything.
 *
 * Usage: node scripts/serve-preview.mjs [port]
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../inline-edit-tool/extension');
const PORT = Number(process.argv[2]) || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const target = resolve(ROOT, `.${normalize(path)}`);

  // Never serve outside the extension directory.
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

server.listen(PORT, () => {
  console.log(`\n  Inline Edit Tool preview\n`);
  console.log(`  →  http://localhost:${PORT}/preview.html\n`);
  console.log(`  Pick the pencil in the rail, then click any text.`);
  console.log(`  Ctrl-C to stop.\n`);
});
