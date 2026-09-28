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
 * Every example renders the same component, so what differs is the framework.
 *
 * The line numbers differ because a Vue SFC opens with <template> and a JSX
 * file with an import. *Which* elements get annotated differs too, and that
 * is deliberate: a plugin should annotate exactly what its codemod can then
 * edit safely.
 *
 *   React  — the JSX codemod works on the AST and can rewrite a single
 *            JSXText node, so an element mixing text with `{expr}` is
 *            editable and gets annotated.
 *   Vue    — same, via the template AST.
 *   Svelte — routes to the HTML codemod, which replaces an element's whole
 *            inner range. Text beside a `{expr}` cannot be rewritten without
 *            destroying the expression, so those elements are left alone.
 *
 * Annotating what cannot be committed would offer an edit that silently
 * fails at PR time, which is worse than not offering it.
 */
const EXAMPLES_UNDER_TEST = [
  { name: 'react', file: 'Banner.jsx', framework: 'react', expected: [6, 7, 8, 9] },
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

  it('annotates exactly the elements its codemod can edit', () => {
    expect(annotatedLines(code)).toEqual(expected);
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
