import { describe, it, expect } from 'vitest';
import { applyJsxEdits } from '../apps/api/src/editing/codemod/jsx.js';
import { applyHtmlEdits } from '../apps/api/src/editing/codemod/html.js';

const JSX = `export default function Hero() {
  return (
    <section>
      <img src="/logo.png" alt="Company logo" width="120" />
      <a href="/pricing" title="See prices">Pricing</a>
      <button aria-label="Close dialog" className="btn btn-primary">×</button>
      <img src={dynamicSrc} alt={caption} />
    </section>
  );
}
`;

const attr = (over) => ({
  sourceFile: 'src/Hero.jsx',
  attribute: 'alt',
  originalText: 'Company logo',
  newText: 'Acme logo',
  sourceLine: 4,
  ...over,
});

describe('jsx attribute editing', () => {
  it('rewrites an attribute value', () => {
    const { content, applied } = applyJsxEdits(JSX, 'src/Hero.jsx', [attr()]);
    expect(content).toContain('alt="Acme logo"');
    expect(applied).toHaveLength(1);
  });

  it('leaves the rest of the element alone', () => {
    const { content } = applyJsxEdits(JSX, 'src/Hero.jsx', [attr()]);
    expect(content).toContain('src="/logo.png"');
    expect(content).toContain('width="120"');
  });

  it('edits href', () => {
    const { content } = applyJsxEdits(JSX, 'src/Hero.jsx', [
      attr({ attribute: 'href', originalText: '/pricing', newText: '/plans', sourceLine: 5 }),
    ]);
    expect(content).toContain('href="/plans"');
  });

  it('edits aria-label', () => {
    const { content } = applyJsxEdits(JSX, 'src/Hero.jsx', [
      attr({ attribute: 'aria-label', originalText: 'Close dialog', newText: 'Dismiss', sourceLine: 6 }),
    ]);
    expect(content).toContain('aria-label="Dismiss"');
  });

  it('edits className, which is how class editing lands', () => {
    const { content } = applyJsxEdits(JSX, 'src/Hero.jsx', [
      attr({
        attribute: 'className',
        originalText: 'btn btn-primary',
        newText: 'btn btn-secondary rounded-lg',
        sourceLine: 6,
      }),
    ]);
    expect(content).toContain('className="btn btn-secondary rounded-lg"');
  });

  it('refuses an attribute set from a variable', () => {
    // alt={caption} points elsewhere; rewriting it in place would be wrong.
    const { failed } = applyJsxEdits(JSX, 'src/Hero.jsx', [
      attr({ originalText: 'caption', newText: 'x', sourceLine: 7 }),
    ]);
    expect(failed).toHaveLength(1);
  });

  it('explains when no such attribute is written inline', () => {
    const { failed } = applyJsxEdits(JSX, 'src/Hero.jsx', [
      attr({ attribute: 'placeholder', originalText: 'nope', newText: 'x' }),
    ]);
    expect(failed[0].reason).toMatch(/No editable placeholder/);
  });

  it('escapes a quote that would close the attribute early', () => {
    const { content } = applyJsxEdits(JSX, 'src/Hero.jsx', [
      attr({ newText: 'The "Acme" logo' }),
    ]);
    expect(content).toContain('alt="The &quot;Acme&quot; logo"');
    expect(content).not.toContain('alt="The "Acme" logo"');
  });

  it('disambiguates duplicate values by line', () => {
    const src = `<div>\n  <img alt="Logo" />\n  <img alt="Logo" />\n</div>`;
    const { content } = applyJsxEdits(src, 'a.jsx', [
      { attribute: 'alt', originalText: 'Logo', newText: 'Second', sourceLine: 3 },
    ]);
    expect(content).toBe(`<div>\n  <img alt="Logo" />\n  <img alt="Second" />\n</div>`);
  });

  it('applies a text edit and an attribute edit together', () => {
    const { applied, content } = applyJsxEdits(JSX, 'src/Hero.jsx', [
      attr(),
      { originalText: 'Pricing', newText: 'Plans', sourceLine: 5 },
    ]);
    expect(applied).toHaveLength(2);
    expect(content).toContain('alt="Acme logo"');
    expect(content).toContain('>Plans<');
  });
});

describe('html attribute editing', () => {
  const HTML = `<nav>\n  <img src="/a.png" alt="Logo">\n  <a href="/x" title="Go">Link</a>\n</nav>`;

  it('rewrites an attribute', () => {
    const { content } = applyHtmlEdits(HTML, 'nav.html', [
      { attribute: 'alt', originalText: 'Logo', newText: 'Brand', sourceLine: 2 },
    ]);
    expect(content).toContain('alt="Brand"');
    expect(content).toContain('src="/a.png"');
  });

  it('rewrites href without touching the link text', () => {
    const { content } = applyHtmlEdits(HTML, 'nav.html', [
      { attribute: 'href', originalText: '/x', newText: '/y', sourceLine: 3 },
    ]);
    expect(content).toContain('href="/y"');
    expect(content).toContain('>Link<');
  });

  it('reports a missing attribute', () => {
    const { failed } = applyHtmlEdits(HTML, 'nav.html', [
      { attribute: 'alt', originalText: 'Absent', newText: 'x', sourceLine: 2 },
    ]);
    expect(failed).toHaveLength(1);
  });
});
