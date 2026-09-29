import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * The four annotation plugins must agree on the rules.
 *
 * Nothing checked this, and they had silently diverged:
 *
 *   - Svelte and Angular still used a *tag allowlist* — p, h1-h6, span, a,
 *     button, label, li, td, th, strong, em, small, b, i — that React and
 *     Vue had abandoned. On a utility-class codebase that misses every
 *     `<div>` holding copy, which is most of the page.
 *   - Angular emitted no `data-edit-col`, so two elements on one line
 *     produced the same `editKey` in the extension and collided in the edit
 *     session.
 *   - Only Vue stamped provenance on a component root, so on the other
 *     three an image or an icon had no annotated ancestor and Inspect and
 *     Comment could name no file for it.
 *
 * Each was found by reading, not by a failing test. This file is the net.
 *
 * Every plugin is exercised through its real entry point on equivalent
 * markup, and asserted on *behaviour* rather than output text, because the
 * four legitimately differ in syntax and in column base.
 */

process.env.INLINE_EDIT = '1';

/** One component per framework, expressing the same page. */
const PLUGINS = [
  {
    name: 'react',
    annotate(markup) {
      const babel = require('@babel/core');
      const plugin = require('../annotation/react/index.js');
      return babel.transformSync(`export default () => (\n${markup}\n);`, {
        plugins: [plugin.default || plugin],
        parserOpts: { plugins: ['jsx'] },
        filename: '/p/src/Hero.jsx',
        cwd: '/p',
        configFile: false,
        babelrc: false,
      }).code;
    },
  },
  {
    name: 'vue',
    annotate(markup) {
      const mod = require('../annotation/vue/index.js');
      const plugin = (mod.default || mod)();
      plugin.configResolved({ command: 'build', mode: 'production' });
      const out = plugin.transform(`<template>\n${markup}\n</template>`, '/p/src/Hero.vue');
      return out ? out.code : '';
    },
  },
  {
    name: 'svelte',
    annotate(markup) {
      const { annotateSource } = require('../annotation/svelte/annotator.js');
      return annotateSource(markup, 'src/Hero.svelte');
    },
  },
  {
    name: 'angular',
    annotate(markup) {
      const { annotateSource } = require('../annotation/angular/template-annotator.js');
      return annotateSource(markup, 'src/hero.html', 'angular');
    },
  },
];

/** Attributes on each annotated tag, as the browser would see them. */
function tags(output) {
  return [...output.matchAll(/<([a-zA-Z][\w-]*)((?:\s+[a-z0-9-]+=(?:"[^"]*"|\{?"[^"]*"\}?))*)/g)]
    .filter((m) => m[2].includes('data-edit-file'))
    .map((m) => ({
      tag: m[1].toLowerCase(),
      editable: m[2].includes('data-editable'),
      line: Number(/data-edit-line=\{?"(\d+)"/.exec(m[2])?.[1]),
      col: /data-edit-col=\{?"(\d+)"/.exec(m[2])?.[1],
      framework: /data-edit-framework=\{?"([a-z]+)"/.exec(m[2])?.[1],
      i18nKey: /data-edit-i18n-key=\{?"([^"]*)"/.exec(m[2])?.[1],
    }));
}

const editable = (output) => tags(output).filter((t) => t.editable);

describe.each(PLUGINS)('$name', ({ name, annotate }) => {
  it('records which framework produced the element', () => {
    expect(tags(annotate('<p>Copy</p>'))[0].framework).toBe(name);
  });

  it('records a line and a column on every annotation', () => {
    // The extension builds an element's identity from file:line:col.
    // Angular omitted the column, so two elements on one line shared a key.
    for (const t of tags(annotate('<div><span>One</span><span>Two</span></div>'))) {
      expect(Number.isFinite(t.line), `${name}: no line`).toBe(true);
      expect(t.col, `${name}: no column`).toBeDefined();
    }
  });

  it('gives two elements on one line distinct coordinates', () => {
    const found = tags(annotate('<div><span>One</span><span>Two</span></div>'));
    const keys = found.map((t) => `${t.line}:${t.col}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe.each(PLUGINS)('$name — what may be edited', ({ name, annotate }) => {
  it('offers a div holding copy, not just a fixed list of tags', () => {
    // The allowlist this replaced missed every <div> holding copy, which on
    // a utility-class codebase is most of the page.
    expect(editable(annotate('<div>Focus on the things you love</div>')).length).toBe(1);
  });

  it('offers other non-listed containers too', () => {
    for (const tag of ['section', 'article', 'figcaption']) {
      const found = editable(annotate(`<${tag}>Copy</${tag}>`));
      expect(found.length, `${name}: <${tag}>`).toBe(1);
    }
  });

  it('does not offer an element whose only child is an expression', () => {
    // Nothing literal for the codemod to rewrite.
    const markup = name === 'react' || name === 'svelte' ? '<div>Copy<p>{count}</p></div>' : '<div>Copy<p>{{ count }}</p></div>';
    const found = editable(annotate(markup));
    expect(found.some((t) => t.tag === 'p')).toBe(false);
  });

  it('does not offer an empty element', () => {
    expect(editable(annotate('<div>Copy<p></p></div>')).some((t) => t.tag === 'p')).toBe(false);
  });
});

describe.each(PLUGINS)('$name — provenance is wider than editing', ({ name, annotate }) => {
  it('annotates a root that holds no text, so an image can inherit it', () => {
    // The reported failure: a footer of images and icons, where nothing up
    // the tree carried an annotation, so every comment said "no build
    // annotation" and named no file.
    const found = tags(annotate('<div class="row"><img src="/a.svg" /></div>'));
    expect(found.length, `${name}: nothing annotated`).toBeGreaterThan(0);
    expect(found[0].editable, `${name}: a textless root must not be editable`).toBe(false);
  });

  it('never marks something editable without also recording where it came from', () => {
    const output = annotate('<div class="wrap"><h1>Title</h1><img src="/a.svg" /></div>');
    for (const t of editable(output)) {
      expect(Number.isFinite(t.line), `${name}: editable with no provenance`).toBe(true);
    }
  });
});

// ============================================================
//  Never offer an edit that would destroy something
//
//  The codemods differ in what they can do safely, and the
//  plugins have to match their own. Getting this wrong does not
//  produce an error — it produces a pull request that quietly
//  deletes a link, or writes a data binding away.
//
//  Angular got both wrong. It stripped child tags and kept
//  their text, so a <p> counted an anchor's copy as its own;
//  and it ignored {{ }} entirely. Svelte, feeding the same
//  codemod, had always refused both.
// ============================================================
describe.each(PLUGINS)('$name — edits that would destroy content', ({ name, annotate }) => {
  const usesHtmlCodemod = name === 'svelte' || name === 'angular';

  it('never offers an element whose child element would be deleted', () => {
    // The HTML codemod replaces the whole inner range. React and Vue
    // rewrite the individual text *run*, so they may offer it.
    const output = annotate('<section><p>Read our <a href="/x">guide</a></p></section>');
    const offered = editable(output).map((t) => t.tag);

    expect(offered, `${name}: the anchor is always safe`).toContain('a');
    if (usesHtmlCodemod) {
      expect(offered, `${name}: rewriting <p> would delete the <a>`).not.toContain('p');
    }
  });

  it('never counts a child element\'s text as its own', () => {
    // `<div><h2>Title</h2></div>` — the div holds no copy of its own.
    const offered = editable(annotate('<div><h2>Title</h2></div>')).map((t) => t.tag);
    expect(offered, `${name}`).not.toContain('div');
  });

  it('never offers an element whose binding would be written away', () => {
    // Only for the plugins feeding the HTML codemod, which replaces the
    // whole inner range. React and Vue rewrite the individual text *run*,
    // so " deploys" beside `{count}` is legitimately theirs to edit — and
    // the binding survives. That difference is deliberate, not an
    // inconsistency.
    const markup =
      name === 'react' || name === 'svelte'
        ? '<div><p>{count} deploys</p></div>'
        : '<div><p>{{ count }} deploys</p></div>';
    const offered = editable(annotate(markup)).map((t) => t.tag);

    if (usesHtmlCodemod) {
      expect(offered, `${name}: rewriting <p> would write the binding away`).not.toContain('p');
    } else {
      expect(offered, `${name}: the run beside the binding is editable`).toContain('p');
    }
  });

  it('is idempotent, including on a root with children', () => {
    // Build tools do transform a file more than once. A root skipped as
    // already-annotated must still count as a root, or a nested child is
    // mistaken for one and annotated again — with a column measured into
    // the already-annotated string.
    if (name === 'react' || name === 'vue') return; // AST-based, structural

    const markup = '<div class="row"><em></em></div>';
    const once = annotate(markup);
    expect(annotate(once), `${name}`).toBe(once);
  });
});

// ============================================================
//  Translated copy
//
//  Text behind a translation function has no literal in the
//  component — it lives in a locale file. Without the key it is
//  unreachable: nothing to annotate, and nothing for
//  `resolveI18nEdits` to redirect.
//
//  This shipped in React only. The whole i18n path — the
//  service, `locale.js`, the locale-file ranking — existed and
//  was tested, and served one framework of four.
// ============================================================
const I18N_MARKUP = {
  // A lone translation call, no literal beside it.
  react: "<h1>{t('hero.title')}</h1>",
  vue: "<h1>{{ $t('hero.title') }}</h1>",
  svelte: "<h1>{$_('hero.title')}</h1>",
  // The pipe is the dominant Angular idiom, and reads the other way round.
  angular: "<h1>{{ 'hero.title' | translate }}</h1>",
};

const COMPUTED_MARKUP = {
  react: '<h1>{count}</h1>',
  vue: '<h1>{{ count }}</h1>',
  svelte: '<h1>{count}</h1>',
  angular: '<h1>{{ count }}</h1>',
};

describe.each(PLUGINS)('$name — translated copy', ({ name, annotate }) => {
  it('records the translation key', () => {
    const found = tags(annotate(I18N_MARKUP[name]));
    expect(found[0]?.i18nKey, `${name}: no key`).toBe('hero.title');
  });

  it('offers it for editing, since the locale file can be rewritten', () => {
    const found = editable(annotate(I18N_MARKUP[name]));
    expect(found.length, `${name}`).toBe(1);
  });

  it('does not invent a key for an ordinary expression', () => {
    // A wrong key sends the edit into the wrong entry of a locale file, and
    // nothing in the pull request would look out of place.
    const found = tags(annotate(COMPUTED_MARKUP[name]));
    expect(found[0]?.i18nKey, `${name}`).toBeUndefined();
  });

  it('does not offer an ordinary expression for editing', () => {
    expect(editable(annotate(COMPUTED_MARKUP[name])).length, `${name}`).toBe(0);
  });
});
