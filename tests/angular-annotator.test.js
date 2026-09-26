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
    expect(attr(out, 'data-edit-line')).toBe('2');
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

  it('skips elements with no direct text', () => {
    const out = annotateSource('<p><img src="a.png"></p>', FILE, 'angular');
    expect(out).not.toContain('data-edit-file');
  });

  it('skips whitespace-only elements', () => {
    const out = annotateSource('<p>   \n  </p>', FILE, 'angular');
    expect(out).not.toContain('data-edit-file');
  });

  it('skips self-closing tags', () => {
    const out = annotateSource('<span />', FILE, 'angular');
    expect(out).not.toContain('data-edit-file');
  });

  it('skips tags that are not text-bearing', () => {
    const out = annotateSource('<section>Hello</section>', FILE, 'angular');
    expect(out).not.toContain('data-edit-file');
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
    const src = '<div><section>x</section></div>';
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
