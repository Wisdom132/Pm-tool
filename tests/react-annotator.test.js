import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { transformSync } from '@babel/core';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const plugin = require('../annotation/react/index.js');

/**
 * Run the annotation plugin over a JSX snippet.
 * INLINE_EDIT is set so the plugin is active regardless of NODE_ENV.
 */
function transform(code, { filename = '/repo/src/Hero.jsx' } = {}) {
  return transformSync(code, {
    filename,
    cwd: '/repo',
    babelrc: false,
    configFile: false,
    plugins: [require('@babel/plugin-syntax-jsx'), plugin],
  }).code;
}

/** Read one attribute's value out of transformed output. */
function attr(code, name) {
  const m = new RegExp(`${name}="([^"]*)"`).exec(code);
  return m ? m[1] : null;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.INLINE_EDIT = '1';
  // Pin build info so <html> assertions are deterministic.
  process.env.INLINE_EDIT_BRANCH = 'feature/pricing';
  process.env.INLINE_EDIT_COMMIT = 'abc123';
  process.env.INLINE_EDIT_REPO = 'acme/site';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('react annotation plugin', () => {
  it('annotates a text-bearing element', () => {
    const out = transform('<h1>Hello</h1>');
    expect(out).toContain('data-editable="true"');
    expect(out).toContain('data-edit-framework="react"');
  });

  it('records a repo-relative file path', () => {
    // Regression: the visitor parameter used to be named `path`, shadowing the
    // `path` module and making this call throw on every annotated element.
    const out = transform('<h1>Hello</h1>', { filename: '/repo/src/Hero.jsx' });
    expect(attr(out, 'data-edit-file')).toBe('src/Hero.jsx');
  });

  it('does not throw on a file containing many elements', () => {
    expect(() => transform('<div><h1>A</h1><p>B</p><span>C</span></div>')).not.toThrow();
  });

  it('records 1-based line and 0-based column', () => {
    const out = transform('<div>\n  <h1>Hello</h1>\n</div>');
    // The <div> is the JSX root and carries provenance, so read the
    // coordinates off the element that is actually editable.
    const h1 = /<h1 ([^>]*)>/.exec(out)[1];
    expect(/data-edit-line="(\d+)"/.exec(h1)[1]).toBe('2');
    expect(/data-edit-col="(\d+)"/.exec(h1)[1]).toBe('2');
  });

  it('offers each qualifying element for editing', () => {
    const out = transform('<div><h1>A</h1><p>B</p></div>');
    // Two editable, plus provenance on the root div.
    expect(out.match(/data-editable/g)).toHaveLength(2);
    expect(out.match(/data-edit-file/g)).toHaveLength(3);
  });

  it('does not offer an element whose text is an expression', () => {
    // It is the root here, so it carries provenance; there is simply no
    // literal for the codemod to rewrite.
    const out = transform('<h1>{title}</h1>');
    expect(out).not.toContain('data-editable');
    expect(out).toContain('data-edit-file');
  });

  it('annotates a nested expression-only element, but does not offer it', () => {
    // Provenance says "this came from here", which is true. `data-editable`
    // says "the codemod can rewrite this", which is not.
    // Expression-*only*: `{count} deploys` would be editable, because
    // " deploys" is literal text the codemod can rewrite.
    const out = transform('<div>Copy<p>{count}</p></div>');
    expect(/<p\s+data-edit-file/.test(out)).toBe(true);
    expect(/<p\s+[^>]*data-editable/.test(out)).toBe(false);
  });

  it('annotates literal text sitting beside an expression', () => {
    // "Hello" is real copy in the file; `{name}` is left alone. The codemod
    // rewrites the run, not the element.
    expect(transform('<h1>Hello {name}</h1>')).toContain('data-edit-file');
  });

  it('still leaves an element with no literal text of its own uneditable', () => {
    expect(transform('<h1>{name}</h1>')).not.toContain('data-editable');
  });

  it('does not offer whitespace-only children for editing', () => {
    const out = transform('<p>\n  \n</p>');
    expect(out).not.toContain('data-editable');
  });

  it('annotates any tag that holds only text', () => {
    // Not a tag allowlist: the rule is what the codemod can edit. A list
    // missed every <div> holding copy, which on a utility-class codebase is
    // most of the page.
    expect(transform('<section>Hello</section>')).toContain('data-edit-file');
    expect(transform('<div className="card-title">Freshly Cooked Meals</div>')).toContain(
      'data-edit-file'
    );
  });

  it('does not offer a container with no text of its own', () => {
    // It is the JSX root, so it carries provenance — that is how an image
    // inside it finds a file — but there is nothing to rewrite.
    const out = transform('<div><h1>Only the h1</h1></div>');
    expect(/<div [^>]*data-editable/.test(out)).toBe(false);
    expect(/<div [^>]*data-edit-file/.test(out)).toBe(true);
  });

  it('skips React components', () => {
    const out = transform('<Hero>Hello</Hero>');
    expect(out).not.toContain('data-edit-file');
  });

  it('is idempotent', () => {
    const once = transform('<h1>Hello</h1>');
    expect(transform(once)).toBe(once);
  });

  it('preserves existing attributes', () => {
    const out = transform('<h1 className="title">Hello</h1>');
    expect(out).toContain('className="title"');
    expect(out).toContain('data-edit-file');
  });

  it('stamps build provenance on <html>', () => {
    const out = transform('<html lang="en"><body>x</body></html>');
    expect(out).toContain('data-edit-branch="feature/pricing"');
    expect(out).toContain('data-edit-commit="abc123"');
    expect(out).toContain('data-edit-repo="acme/site"');
  });

  it('stamps provenance on the Next.js <Html> element', () => {
    const out = transform('<Html lang="en"><body>x</body></Html>');
    expect(out).toContain('data-edit-branch="feature/pricing"');
  });

  it('does not treat <html> as an editable text element', () => {
    const out = transform('<html>text</html>');
    expect(out).not.toContain('data-edit-file');
  });

  it('does nothing when INLINE_EDIT is off', () => {
    process.env.INLINE_EDIT = '0';
    const out = transform('<h1>Hello</h1>');
    expect(out).not.toContain('data-edit-i18n-key');
  });

  it('runs in development when INLINE_EDIT is unset', () => {
    delete process.env.INLINE_EDIT;
    process.env.NODE_ENV = 'development';
    expect(transform('<h1>Hello</h1>')).toContain('data-edit-file');
  });

  it('stays off in production when INLINE_EDIT is unset', () => {
    delete process.env.INLINE_EDIT;
    process.env.NODE_ENV = 'production';
    expect(transform('<h1>Hello</h1>')).not.toContain('data-edit-i18n-key');
  });
});

describe('i18n annotation', () => {
  it('records the key for a t() call', () => {
    const out = transform(`<h1>{t('hero.title')}</h1>`);
    expect(attr(out, 'data-edit-i18n-key')).toBe('hero.title');
    expect(out).toContain('data-editable="true"');
  });

  it('handles a member-expression translator', () => {
    const out = transform(`<p>{i18n.t('nav.home')}</p>`);
    expect(attr(out, 'data-edit-i18n-key')).toBe('nav.home');
  });

  it.each(['t', '$t', 'translate'])('recognises %s()', (fn) => {
    const out = transform(`<span>{${fn}('a.b')}</span>`);
    expect(attr(out, 'data-edit-i18n-key')).toBe('a.b');
  });

  it('does not treat an unrelated function call as a translation', () => {
    const out = transform(`<h1>{formatDate(now)}</h1>`);
    expect(out).not.toContain('data-edit-i18n-key');
  });

  it('does not treat a bare expression as a translation', () => {
    const out = transform(`<h1>{title}</h1>`);
    expect(out).not.toContain('data-edit-i18n-key');
  });

  it('ignores a key that is not a literal', () => {
    // A computed key cannot be resolved to a locale entry at build time.
    const out = transform(`<h1>{t(keyVar)}</h1>`);
    expect(out).not.toContain('data-edit-i18n-key');
  });

  it('does not tag plain text as i18n', () => {
    const out = transform('<h1>Hello</h1>');
    expect(out).toContain('data-edit-file');
    expect(out).not.toContain('data-edit-i18n-key');
  });

  it('ignores a translation mixed with literal text', () => {
    // Which part the editor changed would be ambiguous.
    const out = transform(`<h1>Welcome {t('name')}</h1>`);
    expect(out).not.toContain('data-edit-i18n-key');
  });
});
