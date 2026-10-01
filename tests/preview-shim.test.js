import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The example preview shim must answer every path the extension calls.
 *
 * This exists because it silently stopped doing so. The extension was
 * repointed from the old pr-service protocol to `/api/resolve` and
 * `/api/editing/*`, and the shim kept answering the old paths — so the
 * Comment tool selected an element, asked what site it was on, got
 * "unhandled path /api/resolve", and quietly did nothing.
 *
 * Nothing caught it: the extension's integration tests run against the real
 * API, and the shim is only exercised by a human opening a page.
 */

const EXTENSION = new URL('../inline-edit-tool/extension/src', import.meta.url).pathname;
/**
 * Both of them. There are two: the Vite plugin the example apps and the
 * Nuxt module use, and the standalone one behind `preview.html`. Checking
 * only the first is exactly how the second stayed on the old protocol.
 */
const SHIMS = {
  'annotation/preview/index.cjs': new URL('../annotation/preview/index.cjs', import.meta.url).pathname,
  'extension/preview-shim.js': new URL('../inline-edit-tool/extension/preview-shim.js', import.meta.url).pathname,
};

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.js') ? [path] : [];
  });
}

/**
 * Every `/api/...` literal the extension builds a request from.
 *
 * The *static prefix* is kept, not a fixed number of segments: collapsing
 * `/api/editing/file` and `/api/editing/branches` to `/api/editing` would
 * pass while the shim answered only one of them. A path is cut at the first
 * query or template interpolation, since everything after that is an id.
 */
function pathsTheExtensionCalls() {
  const found = new Set();
  for (const file of sourceFiles(EXTENSION)) {
    const source = readFileSync(file, 'utf8');
    for (const [, literal] of source.matchAll(/["'`](\/api\/[^"'`]*)/g)) {
      const prefix = literal.split('?')[0].split('$')[0].replace(/\/+$/, '');
      if (prefix.length > '/api/'.length) found.add(prefix);
    }
  }
  return [...found].sort();
}

describe.each(Object.entries(SHIMS))('%s', (_name, file) => {
  const shim = readFileSync(file, 'utf8');
  const called = pathsTheExtensionCalls();

  it('finds the paths the extension actually calls', () => {
    // Guards the test: a broken scan would make everything below vacuous.
    expect(called.length).toBeGreaterThan(4);
    expect(called).toContain('/api/resolve');
  });

  it.each(pathsTheExtensionCalls())('handles %s', (path) => {
    // The shim matches on prefixes, so containing the literal is enough —
    // and is exactly what was missing for /api/resolve.
    expect(shim, `${path} has no branch in the shim`).toContain(path);
  });

  it('no longer answers paths the extension stopped calling', () => {
    // Left behind, these look like working support for a protocol that is
    // gone — which is how the drift went unnoticed for a whole phase.
    const retired = ['/api/create-pr', '/api/create-issue', '/api/auth/extension', '/api/repos'];
    const stale = retired.filter((path) => shim.includes(`"${path}`) || shim.includes(`'${path}`));
    expect(stale).toEqual([]);
  });

  it('answers the site registry, which gates every other call', () => {
    // Without this the extension never gets an environmentId, so every tool
    // that needs one stops before it starts.
    expect(shim).toMatch(/\/api\/resolve/);
    expect(shim).toMatch(/environmentId/);
    expect(shim).toMatch(/known:\s*true/);
  });
});
