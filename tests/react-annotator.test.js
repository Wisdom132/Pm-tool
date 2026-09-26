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
    expect(attr(out, 'data-edit-line')).toBe('2');
    expect(attr(out, 'data-edit-col')).toBe('2');
  });

  it('annotates each qualifying element', () => {
    const out = transform('<div><h1>A</h1><p>B</p></div>');
    expect(out.match(/data-edit-file/g)).toHaveLength(2);
  });

  it('skips elements whose text is an expression', () => {
    const out = transform('<h1>{title}</h1>');
    expect(out).not.toContain('data-edit-file');
  });

  it('annotates an element mixing text and an expression', () => {
    const out = transform('<h1>Hello {name}</h1>');
    expect(out).toContain('data-edit-file');
  });

  it('skips whitespace-only children', () => {
    const out = transform('<p>\n  \n</p>');
    expect(out).not.toContain('data-edit-file');
  });

  it('skips non-text-bearing tags', () => {
    const out = transform('<section>Hello</section>');
    expect(out).not.toContain('data-edit-file');
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
    expect(out).not.toContain('data-edit');
  });

  it('runs in development when INLINE_EDIT is unset', () => {
    delete process.env.INLINE_EDIT;
    process.env.NODE_ENV = 'development';
    expect(transform('<h1>Hello</h1>')).toContain('data-edit-file');
  });

  it('stays off in production when INLINE_EDIT is unset', () => {
    delete process.env.INLINE_EDIT;
    process.env.NODE_ENV = 'production';
    expect(transform('<h1>Hello</h1>')).not.toContain('data-edit');
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

  it('ignores an unrelated function call', () => {
    const out = transform(`<h1>{formatDate(now)}</h1>`);
    expect(out).not.toContain('data-edit');
  });

  it('ignores a bare expression', () => {
    const out = transform(`<h1>{title}</h1>`);
    expect(out).not.toContain('data-edit');
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
