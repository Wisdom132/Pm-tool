import { describe, it, expect } from 'vitest';
import {
  annotateSource,
  annotateInlineTemplates,
} from '../annotation/angular/template-annotator.js';

const FILE = 'src/app/hero.component.html';

/** Pull the value of one data-edit-* attribute out of annotated output. */
function attr(html, name) {
  const m = new RegExp(`${name}="([^"]*)"`).exec(html);
  return m ? m[1] : null;
}

describe('annotateSource', () => {
  it('annotates a text-bearing element', () => {
    const out = annotateSource('<p>Hello</p>', FILE, 'angular');
    expect(out).toContain('data-editable="true"');
    expect(out).toContain('data-edit-framework="angular"');
    expect(attr(out, 'data-edit-file')).toBe(FILE);
  });

  it('injects attributes immediately after the tag name', () => {
    const out = annotateSource('<p class="x">Hello</p>', FILE, 'angular');
    expect(out.startsWith('<p data-edit-file=')).toBe(true);
    expect(out).toContain('class="x"');
  });

  it('reports 1-based line numbers', () => {
    const out = annotateSource('<div>\n  <h1>Hi</h1>\n</div>', FILE, 'angular');
    // The <div> is the template root and carries provenance, so read the
    // line off the element that is actually editable.
    expect(/<h1 [^>]*data-edit-line="2"/.test(out)).toBe(true);
  });

  it('applies the lineOffset for inline templates', () => {
    const out = annotateSource('<p>Hi</p>', FILE, 'angular', 10);
    expect(attr(out, 'data-edit-line')).toBe('11');
  });

  it('annotates every qualifying element', () => {
    const out = annotateSource('<h1>A</h1>\n<p>B</p>\n<span>C</span>', FILE, 'angular');
    expect(out.match(/data-edit-file/g)).toHaveLength(3);
  });

  it('keeps line numbers correct across multiple annotations', () => {
    const out = annotateSource('<h1>A</h1>\n<p>B</p>', FILE, 'angular');
    expect(/<h1 [^>]*data-edit-line="1"/.test(out)).toBe(true);
    expect(/<p [^>]*data-edit-line="2"/.test(out)).toBe(true);
  });

  it('does not offer an element with no direct text for editing', () => {
    // It is the root, so it carries provenance — that is how the image
    // inside it finds a file — but there is nothing to rewrite.
    const out = annotateSource('<p><img src="a.png"></p>', FILE, 'angular');
    expect(out).not.toContain('data-editable');
    expect(out).toContain('data-edit-file');
  });

  it('annotates a nested element with no direct text, but does not offer it', () => {
    // Provenance is wide and the editing contract is narrow. This used to
    // skip such elements entirely, which left containers — the things
    // Rearrange moves and Design pads — with no annotation at all.
    const out = annotateSource('<div>Copy<section><img src="a.png"></section></div>', FILE, 'angular');
    expect(/<section [^>]*data-edit-file/.test(out)).toBe(true);
    expect(/<section [^>]*data-editable/.test(out)).toBe(false);
  });

  it('does not offer a whitespace-only element for editing', () => {
    const out = annotateSource('<p>   \n  </p>', FILE, 'angular');
    expect(out).not.toContain('data-editable');
  });

  it('skips self-closing tags', () => {
    const out = annotateSource('<span />', FILE, 'angular');
    expect(out).not.toContain('data-edit-file');
  });

  it('annotates any tag holding copy, not a fixed list of them', () => {
    // This asserted the opposite while the plugin used an allowlist of
    // p/h1-h6/span/a/button/label/li/td/th/strong/em/small/b/i. A <section>
    // or a <div> holding copy is copy, and on a utility-class codebase that
    // is most of the page. The contents decide, not the tag name.
    for (const tag of ['section', 'div', 'article', 'figcaption', 'blockquote']) {
      const out = annotateSource(`<${tag}>Hello</${tag}>`, FILE, 'angular');
      expect(out, tag).toContain('data-editable="true"');
    }
  });

  it('still ignores tags whose text is never page copy', () => {
    for (const tag of ['script', 'style', 'title']) {
      const out = annotateSource(`<${tag}>x</${tag}>`, FILE, 'angular');
      expect(out, tag).not.toContain('data-edit-file');
    }
  });

  it('is idempotent', () => {
    const once = annotateSource('<p>Hello</p>', FILE, 'angular');
    const twice = annotateSource(once, FILE, 'angular');
    expect(twice).toBe(once);
  });

  it('is not confused by > inside a quoted attribute value', () => {
    const out = annotateSource(`<p title="a > b">Hello</p>`, FILE, 'angular');
    expect(out.match(/data-edit-file/g)).toHaveLength(1);
    expect(out).toContain('title="a > b"');
  });

  it('skips an element whose closing tag is missing', () => {
    const out = annotateSource('<p>Hello', FILE, 'angular');
    expect(out).not.toContain('data-edit-file');
  });

  it('annotates a parent that has both text and a child element', () => {
    const out = annotateSource('<p>Hello <b>there</b></p>', FILE, 'angular');
    expect(out).toContain('<p data-edit-file=');
  });

  it('returns the source unchanged when nothing qualifies', () => {
    // No elements at all, so no root to carry provenance either.
    const src = 'Just some text with no markup.';
    expect(annotateSource(src, FILE, 'angular')).toBe(src);
  });
});

describe('annotateInlineTemplates', () => {
  const TS = `import { Component } from '@angular/core';

@Component({
  template: \`
    <h1>Welcome</h1>
  \`,
})
export class HeroComponent {}`;

  it('annotates HTML inside a template literal', () => {
    const out = annotateInlineTemplates(TS, 'src/app/hero.component.ts');
    expect(out).toContain('data-editable="true"');
    expect(attr(out, 'data-edit-file')).toBe('src/app/hero.component.ts');
  });

  it('reports the line number relative to the TypeScript file', () => {
    const out = annotateInlineTemplates(TS, 'src/app/hero.component.ts');
    // `template: \`` is on line 4, so <h1> lands on line 5.
    expect(attr(out, 'data-edit-line')).toBe('5');
  });

  it('leaves the surrounding TypeScript intact', () => {
    const out = annotateInlineTemplates(TS, 'src/app/hero.component.ts');
    expect(out).toContain("import { Component } from '@angular/core';");
    expect(out).toContain('export class HeroComponent {}');
  });

  it('ignores files with no inline template', () => {
    const src = 'export class Plain {}';
    expect(annotateInlineTemplates(src, 'a.ts')).toBe(src);
  });

  it('is idempotent', () => {
    const once = annotateInlineTemplates(TS, 'src/app/hero.component.ts');
    expect(annotateInlineTemplates(once, 'src/app/hero.component.ts')).toBe(once);
  });
});

// ============================================================
//  Columns
//
//  The extension builds an element's identity from
//  file:line:col (`editKey`). Without a column, two elements
//  on one line produced the *same* key — so editing one and
//  then the other collided in the edit session, and a
//  structural edit matched whichever came first.
//
//  0-based, matching `element-range.js`, because an Angular
//  template is edited by the HTML codemod. Vue's is 1-based
//  and right for Vue: it comes from @vue/compiler-dom, and its
//  codemod compares against that same parser. Nothing compares
//  a column across frameworks.
// ============================================================
describe('columns', () => {
  const cols = (code) => [...code.matchAll(/data-edit-col="(\d+)"/g)].map((m) => Number(m[1]));

  it('distinguishes two elements on the same line', () => {
    const out = annotateSource('<div><span>One</span><span>Two</span></div>', FILE, 'angular');
    const [first, second] = cols(out);
    expect(first).not.toBe(second);
  });

  it('is 0-based, like the HTML codemod it is edited by', () => {
    expect(cols(annotateSource('<p>Hi</p>', FILE, 'angular'))).toEqual([0]);
  });

  it('counts from the start of the line, not the file', () => {
    const out = annotateSource('<div>\n  <p>Hi</p>\n</div>', FILE, 'angular');
    // The root <div> at column 0, then <p> after two spaces of indent.
    expect(cols(out)).toEqual([0, 2]);
  });

  it('gives every element on a line a distinct key', () => {
    // What editKey is built from: file:line:col.
    const out = annotateSource('<b>A</b><i>B</i><u>C</u>', FILE, 'angular');
    const keys = [...out.matchAll(/data-edit-line="(\d+)" data-edit-col="(\d+)"/g)].map(
      (m) => `${m[1]}:${m[2]}`
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('matches where the element actually starts', () => {
    // The column has to point at the '<', because that is what the codemod
    // compares against when it scans the source.
    const source = '<div>\n      <h1>Title</h1>\n</div>';
    const out = annotateSource(source, FILE, 'angular');
    expect(cols(out)).toEqual([0, source.split('\n')[1].indexOf('<h1>')]);
  });
});
