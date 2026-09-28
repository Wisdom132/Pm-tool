import { describe, it, expect } from 'vitest';
import vuePlugin from '../annotation/vue/index.js';

const { findTemplateContentOffset } = vuePlugin;

describe('findTemplateContentOffset', () => {
  it('returns the offset just past a bare <template>', () => {
    const code = '<template>\n  <p>Hi</p>\n</template>';
    expect(findTemplateContentOffset(code, 0)).toBe('<template>'.length);
  });

  it('handles attributes on the template tag', () => {
    const code = '<template lang="html">\n  <p>Hi</p>\n</template>';
    expect(findTemplateContentOffset(code, 0)).toBe('<template lang="html">'.length);
  });

  it('is not fooled by > inside a double-quoted attribute', () => {
    const open = '<template data-x="a > b">';
    expect(findTemplateContentOffset(open + '\n<p>Hi</p>', 0)).toBe(open.length);
  });

  it('is not fooled by > inside a single-quoted attribute', () => {
    const open = "<template data-x='a > b'>";
    expect(findTemplateContentOffset(open + '\n<p>Hi</p>', 0)).toBe(open.length);
  });

  it('respects a non-zero start offset', () => {
    const prefix = '<script setup>const a = 1;</script>\n';
    const code = prefix + '<template>\n  <p>Hi</p>\n</template>';
    expect(findTemplateContentOffset(code, prefix.length)).toBe(
      prefix.length + '<template>'.length
    );
  });

  it('falls back to the start offset when the tag is never closed', () => {
    const code = '<template lang="html"';
    expect(findTemplateContentOffset(code, 0)).toBe(0);
  });

  it('points at content that begins exactly where the tag ends', () => {
    const code = '<template>HELLO</template>';
    const offset = findTemplateContentOffset(code, 0);
    expect(code.slice(offset, offset + 5)).toBe('HELLO');
  });
});

describe('templateContentOffset', () => {
  const { templateContentOffset } = vuePlugin;

  it('takes the offset as given when it already points at the content', () => {
    // Current @vue/compiler-sfc reports the block's content start. Scanning
    // forward from there finds the first child's '>' and shifts every
    // insertion past it — which split `{{ label.length }}` in half and broke
    // the build. The examples/vue build test is what caught it.
    const code = '<template>\n  <section class="banner">\n    <h1>Hi</h1>\n  </section>\n</template>';
    const contentStart = code.indexOf('>') + 1;

    expect(templateContentOffset(code, contentStart)).toBe(contentStart);
  });

  it('still scans when the offset points at the tag', () => {
    // Older versions reported the `<template` tag itself.
    const code = '<template>\n  <h1>Hi</h1>\n</template>';
    expect(templateContentOffset(code, 0)).toBe(code.indexOf('>') + 1);
  });

  it('handles attributes on the template tag', () => {
    const code = '<template lang="html">\n  <h1>Hi</h1>\n</template>';
    expect(templateContentOffset(code, 0)).toBe(code.indexOf('>') + 1);
  });
});

// ============================================================
//  What gets annotated
//
//  The rule is the codemod's rule: an element whose meaningful
//  children are all text. A tag allowlist got this wrong both
//  ways — it missed every <div> holding copy, which on a
//  utility-class codebase is most of the page, and it annotated
//  mixed content the codemod then refused to commit.
// ============================================================
describe('which elements the Vue plugin annotates', () => {
  const transform = (template) => {
    process.env.INLINE_EDIT = '1';
    const plugin = vuePlugin();
    plugin.configResolved({ command: 'build', mode: 'production' });
    const out = plugin.transform(`<template>\n${template}\n</template>`, '/tmp/X.vue');
    return out ? out.code : `<template>\n${template}\n</template>`;
  };

  /** Tags carrying an annotation, in document order. */
  const annotated = (code) =>
    [...code.matchAll(/<(\w+)[^>]*data-edit-file/g)].map((m) => m[1]);

  it('annotates a div that holds only text', () => {
    // The case that matters on a Tailwind codebase: headings and copy are
    // divs, and none of them used to be reachable.
    expect(annotated(transform('  <div class="card-title">Freshly Cooked Meals</div>'))).toEqual([
      'div',
    ]);
  });

  it('annotates an element that also holds another element', () => {
    // Its runs of text are editable individually — the codemod rewrites the
    // run, not the element, so the span survives.
    const code = transform('  <div>Focus on things you <span>love</span> now</div>');
    expect(annotated(code)).toEqual(['div', 'span']);
  });

  it('annotates literal text sitting beside an interpolation', () => {
    // " orders" is real copy in the template; `{{ count }}` is not touched.
    expect(annotated(transform('  <p>{{ count }} orders</p>'))).toEqual(['p']);
  });

  it('still leaves an element with no literal text of its own', () => {
    expect(annotated(transform('  <p>{{ count }}</p>'))).toEqual([]);
  });

  it('still annotates the usual text tags', () => {
    const code = transform('  <h1>Title</h1>\n  <p>Body</p>\n  <a href="/x">Link</a>');
    expect(annotated(code)).toEqual(['h1', 'p', 'a']);
  });

  it('leaves a pure container alone', () => {
    const code = transform('  <div class="grid">\n    <p>Body</p>\n  </div>');
    expect(annotated(code)).toEqual(['p']);
  });

  it('treats whitespace between elements as insignificant', () => {
    // A container's text children are newlines and indentation. Counting
    // those as copy would annotate every wrapper on the page.
    const code = transform('  <div>\n\n    <p>Body</p>\n\n  </div>');
    expect(annotated(code)).toEqual(['p']);
  });
});
