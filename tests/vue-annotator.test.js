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

  /**
   * Tags the codemod is offered, in document order.
   *
   * Not the same set as `annotated`: a component root carries provenance
   * without being editable, so that an image inside it has something to
   * inherit. These tests are about what may be *edited*.
   */
  const editable = (code) =>
    [...code.matchAll(/<(\w+)[^>]*data-editable/g)].map((m) => m[1]);

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
    // An interpolation is not copy the codemod can rewrite.
    expect(editable(transform('  <p>{{ count }}</p>'))).toEqual([]);
  });

  it('still annotates the usual text tags', () => {
    const code = transform('  <h1>Title</h1>\n  <p>Body</p>\n  <a href="/x">Link</a>');
    expect(annotated(code)).toEqual(['h1', 'p', 'a']);
  });

  it('does not offer a pure container for editing', () => {
    // It carries provenance as the template root — that is how an image
    // inside it finds a file — but there is no text to rewrite.
    const code = transform('  <div class="grid">\n    <p>Body</p>\n  </div>');
    expect(editable(code)).toEqual(['p']);
    expect(annotated(code)).toEqual(['div', 'p']);
  });

  it('treats whitespace between elements as insignificant', () => {
    // A container's text children are newlines and indentation. Counting
    // those as copy would offer an edit on every wrapper on the page.
    const code = transform('  <div>\n\n    <p>Body</p>\n\n  </div>');
    expect(editable(code)).toEqual(['p']);
  });
});

// ============================================================
//  Provenance is wider than the editing contract
//
//  These are two different claims and were once emitted together:
//
//    data-editable   the codemod can rewrite this. Narrow, because
//                    offering an edit that fails at pull-request
//                    time is worse than not offering it.
//    data-edit-file  this came from here. Wider, because an image
//                    has no text to edit but still came from
//                    somewhere — and without it the Inspect and
//                    Comment tools could say nothing about any
//                    image, icon or wrapper on the page.
// ============================================================
describe('provenance versus the editing contract', () => {
  const transform = (template) => {
    process.env.INLINE_EDIT = '1';
    const plugin = vuePlugin();
    plugin.configResolved({ command: 'build', mode: 'production' });
    const out = plugin.transform(`<template>\n${template}\n</template>`, '/tmp/X.vue');
    return out ? out.code : `<template>\n${template}\n</template>`;
  };

  /** Tags carrying provenance, and whether each is also editable. */
  const marks = (code) =>
    [...code.matchAll(/<(\w+)((?:\s+[a-z-]+="[^"]*")*)/g)]
      .filter((m) => m[2].includes('data-edit-file'))
      .map((m) => ({ tag: m[1], editable: m[2].includes('data-editable') }));

  it('annotates a component root that holds no text at all', () => {
    // The reported case: a footer of images and icons, where nothing up the
    // tree carried an annotation, so every comment said "no build
    // annotation" and named no file.
    const code = transform('  <section class="downloads">\n    <img src="/play.svg" />\n  </section>');
    expect(marks(code)).toEqual([{ tag: 'section', editable: false }]);
  });

  it('does not offer to edit that root', () => {
    // It has no text, so the codemod cannot rewrite it. Claiming otherwise
    // would produce an edit that fails at pull-request time.
    const code = transform('  <div class="wrap">\n    <img src="/a.svg" />\n  </div>');
    expect(code).toContain('data-edit-file');
    expect(code).not.toContain('data-editable');
  });

  it('still marks a root that does hold text as editable', () => {
    const code = transform('  <div>Focus on the things you love</div>');
    expect(marks(code)).toEqual([{ tag: 'div', editable: true }]);
  });

  it('gives an image an ancestor to inherit from', () => {
    // What the Comment and Inspect tools walk up to find.
    const code = transform('  <section>\n    <div class="row">\n      <img src="/a.svg" />\n    </div>\n  </section>');
    expect(marks(code).length).toBeGreaterThan(0);
    expect(code.indexOf('data-edit-file')).toBeLessThan(code.indexOf('<img'));
  });

  it('annotates every root when a template has several', () => {
    const code = transform('  <img src="/a.svg" />\n  <img src="/b.svg" />');
    expect(marks(code)).toEqual([
      { tag: 'img', editable: false },
      { tag: 'img', editable: false },
    ]);
  });

  it('leaves a component root alone, since it renders elsewhere', () => {
    // A capitalised tag hands its children to something else; annotating
    // here would point at the wrong element.
    const code = transform('  <AppHeader>\n    <img src="/a.svg" />\n  </AppHeader>');
    expect(code).not.toContain('data-edit-file');
  });
});
