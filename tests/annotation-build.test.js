import { describe, it, expect, beforeAll } from 'vitest';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = resolve(here, '../examples');

// ============================================================
//  Real builds of the example apps
//
//  Every plugin here used to be tested against fixture strings
//  only, so "the plugin loads but does nothing" would pass —
//  the failure mode this repo has already hit twice. These run
//  the actual bundler over examples/, using each example's own
//  vite.config.js, so the wiring documented in the README is
//  the wiring under test.
// ============================================================

/**
 * Build one example in memory and return the emitted code.
 *
 * `build.write: false` keeps the examples free of dist/ directories, and the
 * env is restored afterwards so one case cannot leak INLINE_EDIT into the next.
 */
async function buildExample(name, env = {}) {
  const saved = { ...process.env };
  Object.assign(process.env, env);

  try {
    const result = await build({
      root: resolve(EXAMPLES, name),
      logLevel: 'silent',
      build: { write: false, minify: false },
    });

    const output = Array.isArray(result) ? result[0].output : result.output;
    return output
      .filter((chunk) => chunk.type === 'chunk')
      .map((chunk) => chunk.code)
      .join('\n');
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

/**
 * Every data-edit-line in the output, deduplicated and sorted.
 *
 * The shape differs by framework and that is expected: Vue and Svelte compile
 * markup to an HTML string (`data-edit-line="7"`), while JSX compiles to a
 * props object (`"data-edit-line": "6"`). Both are the same annotation.
 */
function annotatedLines(code) {
  const lines = [...code.matchAll(/data-edit-line\\?["']?\s*[:=]\s*\\?["'](\d+)/g)].map((m) =>
    Number(m[1])
  );
  return [...new Set(lines)].sort((a, b) => a - b);
}

/**
 * Lines the *editing* contract covers.
 *
 * Distinct from `annotatedLines`, because the two attributes mean different
 * things and were once emitted together:
 *
 *   data-editable  the codemod can rewrite this. Narrow on purpose —
 *                  offering an edit that fails at pull-request time is
 *                  worse than not offering it.
 *   data-edit-file provenance: "this came from here". Wider, because an
 *                  image or an icon has no text to edit but still came from
 *                  somewhere, and Inspect and Comment need to say where.
 *
 * Scanned per *attribute run* rather than with one regex spanning both
 * attributes: Vue compiles a template into a render function, so there are
 * no tag boundaries in the output and a `[^>]*?` bridge happily matched one
 * element's line number against the next element's `data-editable`.
 */
function editableLines(code) {
  const runs = code.split('data-edit-file').slice(1);
  const lines = [];

  for (const run of runs) {
    // One element's attributes, before the next annotation begins.
    const window = run.slice(0, 200);
    const line = /data-edit-line\\?["']?\s*[:=]\s*\\?["'](\d+)/.exec(window);
    if (line && window.includes('data-editable')) lines.push(Number(line[1]));
  }

  return [...new Set(lines)].sort((a, b) => a - b);
}

/**
 * Every example renders the same component, so what differs is the framework.
 *
 * The line numbers differ because a Vue SFC opens with <template> and a JSX
 * file with an import. *Which* elements get annotated differs too, and that
 * is deliberate: a plugin should annotate exactly what its codemod can then
 * edit safely.
 *
 * The rule is each plugin's own codemod's rule, not a tag allowlist. A list
 * missed every `<div>` holding copy, which on a utility-class codebase is
 * most of the page.
 *
 *   React, Vue — any run of literal text is editable on its own, so an
 *                element holding text *beside* another element or an
 *                `{expr}` is annotated: the codemod rewrites the run and
 *                leaves the child alone.
 *   Svelte     — routes to the HTML codemod, which still replaces an
 *                element's whole inner range, so mixed content is skipped.
 *                That is the honest difference, not an oversight: annotating
 *                it would offer an edit that fails at pull-request time.
 *
 * The three also differ in where their styles live, which is what the
 * editor's Styles tab has to cope with: React imports a stylesheet, Vue and
 * Svelte keep a <style> block inside the component.
 */
const EXAMPLES_UNDER_TEST = [
  { name: 'react', file: 'Banner.jsx', framework: 'react', expected: [8, 9, 10, 11] },
  { name: 'vue', file: 'Banner.vue', framework: 'vue', expected: [3, 4, 5, 6] },
  { name: 'svelte', file: 'Banner.svelte', framework: 'svelte', expected: [7, 8, 10] },
];

describe.each(EXAMPLES_UNDER_TEST)('examples/$name', ({ name, file, framework, expected }) => {
  let code;

  beforeAll(async () => {
    code = await buildExample(name, { INLINE_EDIT: '1' });
  }, 180_000);

  it('annotates through a real build', () => {
    // If the plugin were ordered after the framework compiler, or silently
    // returned null, there would be nothing here.
    expect(code).toContain('data-edit-file');
  });

  it('names the component file', () => {
    expect(code).toContain(file);
  });

  it('records the framework', () => {
    expect(code).toContain(framework);
  });

  it('marks exactly the elements its codemod can edit', () => {
    expect(editableLines(code)).toEqual(expected);
  });

  it('records provenance at least as widely as it offers edits', () => {
    // An image, an icon or a wrapper has no text to edit, but it still came
    // from a file — and without that, Inspect and Comment can say nothing
    // about it. Vue also stamps the component root for this reason.
    const annotated = annotatedLines(code);
    for (const line of editableLines(code)) {
      expect(annotated, `line ${line} is editable but has no provenance`).toContain(line);
    }
  });

  it('inserts attributes at the tag, not into the text', () => {
    // The Vue plugin shifted every insertion past the first child element,
    // landing them mid-expression: `{{ la` + attributes + `bel.length }}`.
    // That failed the build outright, and nothing caught it, because no test
    // had ever run a real build. If an insertion lands inside it again, the
    // expression will not survive as one contiguous string.
    expect(code).toContain('label.length');
  });

  it('ships nothing when the flag is off', async () => {
    // A production build without INLINE_EDIT must carry no annotations at
    // all, or every deploy leaks source paths to anyone who views source.
    const clean = await buildExample(name, { INLINE_EDIT: '', NODE_ENV: 'production' });
    expect(clean).not.toContain('data-edit-file');
  }, 180_000);
});
