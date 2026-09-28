import { describe, it, expect } from 'vitest';
import { applyEditsToFile } from '../apps/api/src/editing/codemod/index.js';
import { applyJsxEdits } from '../apps/api/src/editing/codemod/jsx.js';
import { applyHtmlEdits } from '../apps/api/src/editing/codemod/html.js';
import { applyTextEdits } from '../apps/api/src/editing/codemod/text.js';
import { chooseCandidate, MATCH } from '../apps/api/src/editing/codemod/locate.js';

const HERO = `export default function Hero() {
  return (
    <section>
      <h1 className="title">Build things that mater</h1>
      <p>
        The fastest way to ship.
      </p>
      <span>{dynamic}</span>
      <div>Mixed <b>content</b> here</div>
    </section>
  );
}
`;

const edit = (over) => ({
  sourceFile: 'src/Hero.jsx',
  originalText: 'Build things that mater',
  newText: 'Build things that matter',
  sourceLine: 4,
  ...over,
});

describe('jsx codemod', () => {
  it('replaces the text', () => {
    const { content, applied } = applyJsxEdits(HERO, 'src/Hero.jsx', [edit()]);
    expect(content).toContain('<h1 className="title">Build things that matter</h1>');
    expect(applied).toHaveLength(1);
  });

  it('changes nothing else in the file', () => {
    const { content } = applyJsxEdits(HERO, 'src/Hero.jsx', [edit()]);
    // A printer would reformat everything; magic-string must not.
    const before = HERO.split('\n');
    const after = content.split('\n');
    expect(after.length).toBe(before.length);
    after.forEach((line, i) => {
      if (!line.includes('matter')) expect(line).toBe(before[i]);
    });
  });

  it('preserves surrounding whitespace and indentation', () => {
    const { content } = applyJsxEdits(HERO, 'src/Hero.jsx', [
      edit({ originalText: 'The fastest way to ship.', newText: 'The quickest way.', sourceLine: 5 }),
    ]);
    expect(content).toContain('      <p>\n        The quickest way.\n      </p>');
  });

  it('skips elements whose content is an expression', () => {
    const { failed } = applyJsxEdits(HERO, 'src/Hero.jsx', [
      edit({ originalText: '{dynamic}', newText: 'static', sourceLine: 8 }),
    ]);
    expect(failed).toHaveLength(1);
  });

  it('skips elements mixing text and markup', () => {
    // Overwriting the whole inner range would destroy the <b> element.
    const { failed } = applyJsxEdits(HERO, 'src/Hero.jsx', [
      edit({ originalText: 'Mixed content here', newText: 'x', sourceLine: 9 }),
    ]);
    expect(failed).toHaveLength(1);
  });

  it('applies several edits to one file in a single pass', () => {
    const { content, applied } = applyJsxEdits(HERO, 'src/Hero.jsx', [
      edit(),
      edit({ originalText: 'The fastest way to ship.', newText: 'The quickest way.', sourceLine: 5 }),
    ]);
    expect(applied).toHaveLength(2);
    expect(content).toContain('Build things that matter');
    expect(content).toContain('The quickest way.');
  });

  it('reports a failure instead of throwing when text is gone', () => {
    const { content, applied, failed } = applyJsxEdits(HERO, 'src/Hero.jsx', [
      edit({ originalText: 'Nonexistent copy' }),
    ]);
    expect(applied).toHaveLength(0);
    expect(failed[0].reason).toMatch(/Could not find/);
    expect(content).toBe(HERO);
  });

  it('applies the good edits even when one fails', () => {
    // The old patcher threw, losing the whole pull request.
    const { applied, failed } = applyJsxEdits(HERO, 'src/Hero.jsx', [
      edit(),
      edit({ originalText: 'Nonexistent copy' }),
    ]);
    expect(applied).toHaveLength(1);
    expect(failed).toHaveLength(1);
  });

  it('finds text that has drifted to another line', () => {
    const shifted = '\n\n\n\n\n\n\n\n' + HERO;
    const { applied } = applyJsxEdits(shifted, 'src/Hero.jsx', [edit({ sourceLine: 4 })]);
    expect(applied[0]._match).toBe(MATCH.UNIQUE_TEXT);
  });

  it('handles TSX', () => {
    const tsx = `const A: React.FC = () => <h1>Hello</h1>;`;
    const { content } = applyJsxEdits(tsx, 'src/A.tsx', [
      { originalText: 'Hello', newText: 'Hi', sourceLine: 1 },
    ]);
    expect(content).toContain('<h1>Hi</h1>');
  });

  it('collapses whitespace when matching multi-line text', () => {
    const src = `<p>\n  Hello\n  world\n</p>`;
    const { applied } = applyJsxEdits(src, 'a.jsx', [
      { originalText: 'Hello world', newText: 'Goodbye', sourceLine: 1 },
    ]);
    expect(applied).toHaveLength(1);
  });

  it('refuses an ambiguous match with no usable position', () => {
    const src = `<div><p>Save</p><span>Save</span></div>`;
    const { failed } = applyJsxEdits(src, 'a.jsx', [
      { originalText: 'Save', newText: 'Store', sourceLine: 99 },
    ]);
    expect(failed[0].reason).toMatch(/appears 2 times/);
  });

  it('disambiguates duplicates by line', () => {
    const src = `<div>\n  <p>Save</p>\n  <span>Save</span>\n</div>`;
    const { content } = applyJsxEdits(src, 'a.jsx', [
      { originalText: 'Save', newText: 'Store', sourceLine: 3 },
    ]);
    expect(content).toContain('<p>Save</p>');
    expect(content).toContain('<span>Store</span>');
  });
});

describe('html codemod', () => {
  const NAV = `<nav>\n  <a href="/">Home</a>\n  <button>Submit</button>\n</nav>`;

  it('replaces text in an element', () => {
    const { content } = applyHtmlEdits(NAV, 'nav.html', [
      { originalText: 'Home', newText: 'Start', sourceLine: 2 },
    ]);
    expect(content).toContain('<a href="/">Start</a>');
  });

  it('leaves attributes alone', () => {
    const { content } = applyHtmlEdits(NAV, 'nav.html', [
      { originalText: 'Home', newText: 'Start', sourceLine: 2 },
    ]);
    expect(content).toContain('href="/"');
  });

  it('is not confused by > inside an attribute', () => {
    const src = `<p title="a > b">Hello</p>`;
    const { content } = applyHtmlEdits(src, 'a.html', [
      { originalText: 'Hello', newText: 'Hi', sourceLine: 1 },
    ]);
    expect(content).toBe(`<p title="a > b">Hi</p>`);
  });

  it('skips elements containing markup', () => {
    const src = `<p>Hello <b>there</b></p>`;
    const { failed } = applyHtmlEdits(src, 'a.html', [
      { originalText: 'Hello there', newText: 'x', sourceLine: 1 },
    ]);
    expect(failed).toHaveLength(1);
  });

  it('skips Angular interpolations', () => {
    const src = `<p>{{ greeting }}</p>`;
    const { failed } = applyHtmlEdits(src, 'a.html', [
      { originalText: '{{ greeting }}', newText: 'Hi', sourceLine: 1 },
    ]);
    expect(failed).toHaveLength(1);
  });

  it('applies several edits at once', () => {
    const { content, applied } = applyHtmlEdits(NAV, 'nav.html', [
      { originalText: 'Home', newText: 'Start', sourceLine: 2 },
      { originalText: 'Submit', newText: 'Send', sourceLine: 3 },
    ]);
    expect(applied).toHaveLength(2);
    expect(content).toContain('Start');
    expect(content).toContain('Send');
  });
});

describe('text fallback', () => {
  const SRC = 'alpha\nbeta target\ngamma\ndelta target\n';

  it('replaces near the reported line', () => {
    const { content } = applyTextEdits(SRC, 'a.txt', [
      { originalText: 'target', newText: 'done', sourceLine: 2 },
    ]);
    expect(content.split('\n')[1]).toBe('beta done');
  });

  it('prefers the nearest occurrence', () => {
    const { content } = applyTextEdits(SRC, 'a.txt', [
      { originalText: 'target', newText: 'done', sourceLine: 4 },
    ]);
    expect(content.split('\n')[1]).toBe('beta target');
    expect(content.split('\n')[3]).toBe('delta done');
  });

  it('searches the whole file when the line is wrong', () => {
    // The old implementation gave up outside a +/-2 window.
    const { applied } = applyTextEdits(SRC, 'a.txt', [
      { originalText: 'target', newText: 'done', sourceLine: 400 },
    ]);
    expect(applied).toHaveLength(1);
  });

  it('does not place two edits on the same occurrence', () => {
    const { applied } = applyTextEdits(SRC, 'a.txt', [
      { originalText: 'target', newText: 'one', sourceLine: 2 },
      { originalText: 'target', newText: 'two', sourceLine: 4 },
    ]);
    expect(applied).toHaveLength(2);
  });

  it('reports a failure rather than throwing', () => {
    const { failed } = applyTextEdits(SRC, 'a.txt', [
      { originalText: 'absent', newText: 'x', sourceLine: 1 },
    ]);
    expect(failed).toHaveLength(1);
  });
});

describe('dispatch', () => {
  it('routes by extension', () => {
    const { content } = applyEditsToFile({
      content: `<h1>Hello</h1>`,
      filePath: 'src/A.jsx',
      edits: [{ originalText: 'Hello', newText: 'Hi', sourceLine: 1 }],
    });
    expect(content).toBe('<h1>Hi</h1>');
  });

  it('falls back to text for unknown types', () => {
    const { applied } = applyEditsToFile({
      content: 'title: Hello',
      filePath: 'config.yaml',
      edits: [{ originalText: 'Hello', newText: 'Hi', sourceLine: 1 }],
    });
    expect(applied).toHaveLength(1);
  });

  it('falls back to text when the parser fails', () => {
    // Broken syntax must not lose an otherwise findable edit.
    const { applied, content } = applyEditsToFile({
      content: 'this is ((( not valid javascript <<<>>> Hello',
      filePath: 'src/Broken.jsx',
      edits: [{ originalText: 'Hello', newText: 'Hi', sourceLine: 1 }],
    });
    expect(applied).toHaveLength(1);
    expect(content).toContain('Hi');
  });
});

describe('candidate ranking', () => {
  const candidates = [
    { line: 10, column: 4, text: 'Save', node: 'a' },
    { line: 20, column: 2, text: 'Save', node: 'b' },
  ];

  it('prefers an exact line and column', () => {
    const r = chooseCandidate(candidates, { sourceLine: 20, sourceColumn: 2, originalText: 'Save' });
    expect(r).toEqual({ node: 'b', match: MATCH.EXACT });
  });

  it('falls back to the line alone', () => {
    const r = chooseCandidate(candidates, { sourceLine: 10, sourceColumn: 99, originalText: 'Save' });
    expect(r.match).toBe(MATCH.LINE);
  });

  it('accepts a nearby line', () => {
    const r = chooseCandidate(candidates, { sourceLine: 11, originalText: 'Save' });
    expect(r).toEqual({ node: 'a', match: MATCH.NEAR });
  });

  it('accepts a unique text match with no position', () => {
    const r = chooseCandidate([candidates[0]], { originalText: 'Save' });
    expect(r.match).toBe(MATCH.UNIQUE_TEXT);
  });

  it('refuses an ambiguous match', () => {
    expect(chooseCandidate(candidates, { originalText: 'Save' })).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(chooseCandidate(candidates, { originalText: 'Nope' })).toBeNull();
  });
});

describe('Svelte components', () => {
  const component = [
    '<script>',
    "  const label = '<p>not markup</p>';",
    '  let count = 12;',
    '</script>',
    '',
    '<h1>Ship it on Friday</h1>',
    '<p class="lead">Small changes, reviewed properly.</p>',
    '<p>{count} deploys</p>',
    '',
    '<style>',
    '  p { color: red; }',
    '</style>',
    '',
  ].join('\n');

  it('rewrites text in the markup', () => {
    const result = applyHtmlEdits(component, 'src/lib/Banner.svelte', [
      { originalText: 'Ship it on Friday', newText: 'Ship it on Thursday', sourceLine: 6 },
    ]);

    expect(result.failed).toHaveLength(0);
    expect(result.content).toContain('<h1>Ship it on Thursday</h1>');
  });

  it('never rewrites markup inside a <script> block', () => {
    // Every Svelte component has one, so an unmasked scan would eventually
    // treat a string literal as copy and rewrite code.
    const result = applyHtmlEdits(component, 'src/lib/Banner.svelte', [
      { originalText: 'not markup', newText: 'HACKED', sourceLine: 2 },
    ]);

    expect(result.applied).toHaveLength(0);
    expect(result.content).toContain("const label = '<p>not markup</p>';");
  });

  it('leaves a css selector alone', () => {
    const result = applyHtmlEdits(component, 'src/lib/Banner.svelte', [
      { originalText: 'color: red', newText: 'color: blue', sourceLine: 11 },
    ]);

    expect(result.applied).toHaveLength(0);
    expect(result.content).toContain('p { color: red; }');
  });

  it('refuses an element whose text is an expression', () => {
    // Replacing `{count} deploys` with static text would drop a live value.
    const result = applyHtmlEdits(component, 'src/lib/Banner.svelte', [
      { originalText: '{count} deploys', newText: '99 deploys', sourceLine: 8 },
    ]);

    expect(result.applied).toHaveLength(0);
    expect(result.content).toContain('<p>{count} deploys</p>');
  });

  it('routes .svelte through the HTML backend', () => {
    const result = applyEditsToFile({
      content: component,
      filePath: 'src/lib/Banner.svelte',
      edits: [
        { originalText: 'Ship it on Friday', newText: 'Ship it on Thursday', sourceLine: 6 },
      ],
    });

    expect(result.failed).toHaveLength(0);
    expect(result.content).toContain('Ship it on Thursday');
  });
});

describe('JSX text beside another element', () => {
  const src = [
    'export function B() {',
    '  return (',
    '    <p>Read our <a href="/x">guide</a> today</p>',
    '  );',
    '}',
  ].join('\n');

  it('rewrites the run before the element', () => {
    const result = applyJsxEdits(src, 'B.jsx', [
      { originalText: 'Read our', newText: 'See our', sourceLine: 3 },
    ]);

    expect(result.failed).toHaveLength(0);
    expect(result.content).toContain('<p>See our <a href="/x">guide</a>');
  });

  it('leaves the link untouched', () => {
    const result = applyJsxEdits(src, 'B.jsx', [
      { originalText: 'today', newText: 'now', sourceLine: 3 },
    ]);

    expect(result.content).toContain('<a href="/x">guide</a>');
    expect(result.content).toContain('now</p>');
  });

  it('leaves an expression beside the text alone', () => {
    const withExpr = 'const a = <h1>Hello {name} and welcome</h1>;';
    const result = applyJsxEdits(withExpr, 'B.jsx', [
      { originalText: 'and welcome', newText: 'and hello again', sourceLine: 1 },
    ]);

    expect(result.failed).toHaveLength(0);
    expect(result.content).toContain('{name} and hello again');
  });
});
