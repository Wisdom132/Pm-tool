import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  annotateSource,
  maskBlocks,
  findCloseTag,
} = require('../annotation/svelte/annotator.js');

/** The attributes stamped on one tag, as a map. */
function attrsOf(output, tag) {
  const open = new RegExp(`<${tag}\\b[^>]*>`).exec(output);
  if (!open) return null;

  const attrs = {};
  for (const [, name, value] of open[0].matchAll(/([\w-]+)="([^"]*)"/g)) {
    attrs[name] = value;
  }
  return attrs;
}

describe('maskBlocks', () => {
  it('blanks script bodies without moving anything', () => {
    const src = ['<script>', "  const a = '<p>not markup</p>';", '</script>', '<p>real</p>'].join(
      '\n'
    );
    const masked = maskBlocks(src);

    expect(masked).toHaveLength(src.length);
    expect(masked.split('\n')).toHaveLength(src.split('\n').length);
    expect(masked).not.toContain('not markup');
    expect(masked).toContain('<p>real</p>');
  });

  it('blanks style bodies too', () => {
    const src = '<style>\n  p { color: red; }\n</style>\n<p>hi</p>';
    const masked = maskBlocks(src);
    expect(masked).not.toContain('color: red');
    expect(masked).toContain('<p>hi</p>');
  });

  it('keeps the tags themselves', () => {
    const masked = maskBlocks('<script>var x = 1;</script>');
    expect(masked).toContain('<script>');
    expect(masked).toContain('</script>');
  });
});

describe('findCloseTag', () => {
  it('skips a nested element of the same name', () => {
    // "First closing tag wins" would stop at the inner </span>.
    const src = '<span>a <span>b</span> c</span>';
    const close = findCloseTag(src, 'span', '<span>'.length);
    expect(src.slice(close)).toBe('</span>');
  });

  it('does not count a self-closing sibling as an opening', () => {
    const src = '<p>a <p />b</p>';
    const close = findCloseTag(src, 'p', '<p>'.length);
    expect(src.slice(close)).toBe('</p>');
  });

  it('returns null when nothing closes it', () => {
    expect(findCloseTag('<p>unterminated', 'p', 3)).toBeNull();
  });
});

describe('annotateSource', () => {
  const FILE = 'src/lib/Banner.svelte';

  it('annotates a text-bearing element', () => {
    const out = annotateSource('<h1>Ship it on Friday</h1>', FILE);
    expect(attrsOf(out, 'h1')).toEqual({
      'data-edit-file': FILE,
      'data-edit-line': '1',
      'data-edit-col': '0',
      'data-editable': 'true',
      'data-edit-framework': 'svelte',
    });
  });

  it('keeps the element text and existing attributes', () => {
    const out = annotateSource('<p class="lead">Hello</p>', FILE);
    expect(out).toContain('class="lead"');
    expect(out).toContain('>Hello</p>');
  });

  it('numbers lines against the file, not the markup block', () => {
    const src = [
      '<script>',
      "  let name = 'world';",
      '</script>',
      '',
      '<h1>Hello there</h1>',
    ].join('\n');

    expect(attrsOf(annotateSource(src, FILE), 'h1')['data-edit-line']).toBe('5');
  });

  it('leaves markup inside a script string alone', () => {
    const src = ["<script>", "  const t = '<p>in a string</p>';", '</script>'].join('\n');
    expect(annotateSource(src, FILE)).toBe(src);
  });

  it('leaves a css selector alone', () => {
    const src = '<style>\n  p { color: red; }\n</style>';
    expect(annotateSource(src, FILE)).toBe(src);
  });

  it('skips an element that holds an expression', () => {
    // `{count}` is a value the component computes; there is no copy to edit.
    expect(annotateSource('<p>{count} deploys</p>', FILE)).toBe('<p>{count} deploys</p>');
  });

  it('skips an element with child elements', () => {
    const src = '<p>Read our <a href="/x">guide</a></p>';
    // The <a> is annotated on its own; the <p> is not, because rewriting its
    // text would delete the link.
    const out = annotateSource(src, FILE);
    expect(attrsOf(out, 'a')).toBeTruthy();
    expect(/<p\s+data-edit-file/.test(out)).toBe(false);
  });

  it('skips empty and self-closing elements', () => {
    expect(annotateSource('<p></p>', FILE)).toBe('<p></p>');
    expect(annotateSource('<p />', FILE)).toBe('<p />');
  });

  it('leaves Svelte components alone', () => {
    // Capitalised tags are components, not HTML this tool can trace.
    const src = '<Banner>Ship it</Banner>';
    expect(annotateSource(src, FILE)).toBe(src);
  });

  it('is idempotent', () => {
    const once = annotateSource('<h1>Hello</h1>', FILE);
    expect(annotateSource(once, FILE)).toBe(once);
  });

  it('annotates several elements with their own lines', () => {
    const src = ['<h1>Title</h1>', '<p>Body copy</p>', '<button>Go</button>'].join('\n');
    const out = annotateSource(src, FILE);

    expect(attrsOf(out, 'h1')['data-edit-line']).toBe('1');
    expect(attrsOf(out, 'p')['data-edit-line']).toBe('2');
    expect(attrsOf(out, 'button')['data-edit-line']).toBe('3');
  });

  it('records the column of the opening tag', () => {
    const out = annotateSource('<div>\n    <h2>Nested</h2>\n</div>', FILE);
    expect(attrsOf(out, 'h2')['data-edit-col']).toBe('4');
  });

  it('handles a quoted > inside an attribute', () => {
    const src = '<p title="a > b">Text</p>';
    const out = annotateSource(src, FILE);
    expect(attrsOf(out, 'p')['data-edit-file']).toBe(FILE);
    expect(out).toContain('title="a > b"');
  });

  it('annotates the inner of two nested spans, not a broken range', () => {
    const out = annotateSource('<span>outer <span>inner</span></span>', FILE);
    // The outer span has a child element, so only the inner one qualifies.
    expect(out.match(/data-edit-file/g)).toHaveLength(1);
    expect(out).toContain('<span data-edit-file');
  });
});

// ============================================================
//  Round trip
//
//  The annotator writes data-edit-line; the codemod reads it.
//  Nothing checks that those two agree unless a test does — and
//  the Vue plugin shipped with template-relative line numbers
//  against a file-absolute reader for exactly that reason.
// ============================================================
describe('annotation and codemod agree', () => {
  const FILE = 'src/lib/Banner.svelte';
  const component = [
    '<script>',
    "  const label = '<p>not markup</p>';",
    '  let count = 12;',
    '</script>',
    '',
    '<section class="banner">',
    '  <h1>Ship it on Friday</h1>',
    '  <p class="lead">Small changes, reviewed properly.</p>',
    '  <p>{count} deploys this week</p>',
    '  <p>Read our <a href="/guide">guide</a></p>',
    '</section>',
    '',
    '<style>',
    '  p { color: red; }',
    '</style>',
  ].join('\n');

  /** What the browser would see: attributes parsed off each annotated tag. */
  function annotatedElements(output) {
    return [...output.matchAll(/<(\w+)([^>]*data-edit-file[^>]*)>/g)].map(([, tag, attrs]) => {
      const get = (name) => new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1];
      return { tag, file: get('data-edit-file'), line: Number(get('data-edit-line')) };
    });
  }

  it('annotates exactly the elements that hold editable copy', () => {
    const found = annotatedElements(annotateSource(component, FILE));

    expect(found.map((f) => `${f.tag}:${f.line}`)).toEqual([
      'h1:7',
      'p:8',
      'a:10',
    ]);
    // Not the {count} paragraph, not its container, and nothing in the
    // script or style blocks.
    expect(found.every((f) => f.file === FILE)).toBe(true);
  });

  it('resolves every annotated line back through the codemod', async () => {
    const { applyHtmlEdits } = await import(
      '../overlay/pr-service/lib/codemod/html.js'
    );

    const annotated = annotateSource(component, FILE);
    const elements = annotatedElements(annotated);
    expect(elements.length).toBeGreaterThan(0);

    // The codemod runs against the *original* file, which is what is in the
    // repository — the annotations only ever exist in the built output.
    for (const { tag, line } of elements) {
      const original = component.split('\n')[line - 1];
      const text = new RegExp(`<${tag}[^>]*>([^<]*)<`).exec(original)?.[1].trim();

      const result = applyHtmlEdits(component, FILE, [
        { originalText: text, newText: 'REPLACED', sourceLine: line },
      ]);

      expect(result.failed, `${tag} on line ${line}: ${text}`).toHaveLength(0);
      expect(result.content.split('\n')[line - 1]).toContain('REPLACED');
    }
  });
});
