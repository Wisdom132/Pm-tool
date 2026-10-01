import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What the published package actually contains.
 *
 * Every other test in this suite runs against the repository, where every
 * file is present regardless of whether it ships. That is exactly how
 * `@usecaliper/annotation@1.0.0` went out with a Nuxt module that required
 * `../../examples/inline-edit-preview.cjs` — a path that resolved correctly
 * from a `file:` link and resolved to `node_modules/@usecaliper/examples`
 * once installed from npm. The dev server died on boot for every real
 * consumer, and 1252 passing tests had nothing to say about it.
 *
 * So these tests ask npm what the tarball holds, and check the code against
 * that rather than against the working tree.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '../annotation');
const editorDir = path.resolve(here, '../editor');

/**
 * The files npm would publish, via its own packing logic rather than ours.
 *
 * `--ignore-scripts` because a `prepack` hook writes to the same stdout the
 * JSON arrives on, and its first line begins with `[` — so the obvious
 * `JSON.parse(out)` reads the build log instead. The hook's existence is
 * asserted separately; what this needs is the file list.
 */
function packedFiles(cwd) {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out)[0].files.map((f) => f.path);
}

const manifest = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));

describe('the published tarball', () => {
  const files = packedFiles(pkgDir);

  it('contains every entry point `exports` advertises', () => {
    // An exports map naming a file that does not ship is a module that
    // resolves in the repository and throws for everyone else.
    for (const target of Object.values(manifest.exports)) {
      const rel = target.replace(/^\.\//, '');
      expect(files, `exports -> ${target}`).toContain(rel);
    }
  });

  it('contains the licence it claims', () => {
    expect(manifest.license).toBeTruthy();
    expect(files).toContain('LICENSE');
  });

  it('contains a readme', () => {
    expect(files).toContain('README.md');
  });

  it('ships no tests, fixtures or lockfiles', () => {
    // Dead weight in every consumer's node_modules, and a source of
    // confusing stack traces when something does go wrong.
    for (const f of files) {
      expect(f, f).not.toMatch(/\.test\.(js|ts)$/);
      expect(f, f).not.toMatch(/^(tests|fixtures|examples)\//);
      expect(f, f).not.toMatch(/package-lock\.json$/);
    }
  });
});

describe('runtime requires stay inside the package', () => {
  const files = packedFiles(pkgDir);
  const shipped = new Set(files);

  /** Every `require(path.resolve(__dirname, '…'))` in the shipped sources. */
  function resolvedRequires(relFile) {
    const abs = path.join(pkgDir, relFile);
    if (!existsSync(abs)) return [];
    const src = readFileSync(abs, 'utf8');

    // Matches the one form the plugins use to reach sibling files.
    const pattern = /require\(\s*path\.resolve\(\s*__dirname\s*,\s*['"]([^'"]+)['"]/g;
    return [...src.matchAll(pattern)].map((m) => m[1]);
  }

  const sources = files.filter((f) => f.endsWith('.js') || f.endsWith('.cjs'));

  it('resolves every __dirname-relative require to a shipped file', () => {
    // The 1.0.0 bug, stated as a rule. `../../examples/…` escapes the
    // package; from node_modules it lands in a sibling scope directory that
    // does not exist.
    const escapes = [];

    for (const file of sources) {
      for (const target of resolvedRequires(file)) {
        const resolved = path.normalize(path.join(path.dirname(file), target));
        if (resolved.startsWith('..')) {
          escapes.push(`${file} -> ${target} (outside the package)`);
          continue;
        }
        if (!shipped.has(resolved)) {
          escapes.push(`${file} -> ${target} (not in files[])`);
        }
      }
    }

    expect(escapes).toEqual([]);
  });
});

// ============================================================
//  @usecaliper/editor
//
//  The package that makes `preview` work for somebody who is
//  not us. Its whole job is to carry files, so the only way it
//  can fail is by carrying the wrong ones — which is exactly
//  the failure that shipped in annotation 1.0.0.
// ============================================================
describe('the editor package', () => {
  const files = packedFiles(editorDir);
  const editorManifest = JSON.parse(
    readFileSync(path.join(editorDir, 'package.json'), 'utf8')
  );

  it('ships every asset the preview server will ask for', () => {
    // These paths are requested by URL at runtime, so a missing one is a 503
    // in somebody's browser rather than an error at install time.
    for (const name of ['content.js', 'code-editor.js', 'page.css']) {
      expect(files, name).toContain(`dist/${name}`);
    }
  });

  it('ships its entry point and licence', () => {
    expect(files).toContain('index.js');
    expect(files).toContain('LICENSE');
    expect(files).toContain('README.md');
  });

  it('does not ship the browser-extension plumbing', () => {
    // manifest.json, the popup and the side panel are meaningless outside
    // Chrome's extension host. A manifest in node_modules would read as an
    // installable extension, which this is not.
    for (const name of ['manifest.json', 'popup.html', 'popup.js', 'sidepanel.html', 'background.js']) {
      expect(files, name).not.toContain(`dist/${name}`);
    }
  });

  it('builds at pack time rather than trusting the working tree', () => {
    // The 1.0.0 lesson stated as a rule: a file that exists locally and not
    // in the tarball is the failure this package is most exposed to.
    expect(editorManifest.scripts?.prepack).toBeTruthy();
  });

  it('declares the entry point its exports map promises', () => {
    for (const target of Object.values(editorManifest.exports)) {
      expect(files, target).toContain(target.replace(/^\.\//, ''));
    }
  });
});

describe('the two packages stay independent', () => {
  it('annotation does not depend on the editor', () => {
    // The coupling this split exists to prevent. If annotation ever declares
    // the editor as a real dependency, every project installing the plugins
    // downloads ~230 KB of editor it will never load, and the two versions
    // are locked together against the wire contract's own rule.
    const deps = {
      ...(manifest.dependencies || {}),
      ...(manifest.peerDependencies || {}),
    };
    expect(Object.keys(deps)).not.toContain('@usecaliper/editor');
  });

  it('the editor is resolved optionally, inside a try', () => {
    // It is reached for with `require` at runtime and must degrade to a
    // readable message when absent, not throw on import.
    const shim = readFileSync(path.join(pkgDir, 'preview/index.cjs'), 'utf8');
    expect(shim).toMatch(/try\s*{[^}]*require\(\s*['"]@usecaliper\/editor['"]/s);
  });
});
