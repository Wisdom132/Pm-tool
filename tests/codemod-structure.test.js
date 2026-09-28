import { describe, it, expect } from 'vitest';
import { applyEditsToFile } from '../apps/api/src/editing/codemod/index.js';
import {
  applyStructuralEdits,
  applyHtmlStructuralEdits,
} from '../apps/api/src/editing/codemod/structure.js';

const LIST = `export default function Features() {
  return (
    <div className="features">
      <article className="a">First</article>
      <article className="b">Second</article>
      <article className="c">Third</article>
    </div>
  );
}
`;

const op = (over) => ({ sourceFile: 'src/Features.jsx', sourceLine: 5, sourceColumn: 6, ...over });

const lines = (out) => out.split('\n').map((l) => l.trim()).filter(Boolean);

describe('delete', () => {
  it('removes the element', () => {
    const { content, applied } = applyStructuralEdits(LIST, 'src/Features.jsx', [
      op({ op: 'delete' }),
    ]);
    expect(applied).toHaveLength(1);
    expect(content).not.toContain('Second');
    expect(content).toContain('First');
    expect(content).toContain('Third');
  });

  it('leaves no blank line behind', () => {
    const { content } = applyStructuralEdits(LIST, 'src/Features.jsx', [op({ op: 'delete' })]);
    expect(content).not.toMatch(/\n\s*\n\s*<article className="c"/);
  });
});

describe('duplicate', () => {
  it('inserts a copy after the original', () => {
    const { content } = applyStructuralEdits(LIST, 'src/Features.jsx', [
      op({ op: 'duplicate' }),
    ]);
    expect(content.match(/Second/g)).toHaveLength(2);
  });

  it('keeps the copy adjacent and indented like its source', () => {
    const { content } = applyStructuralEdits(LIST, 'src/Features.jsx', [
      op({ op: 'duplicate' }),
    ]);
    const body = lines(content);
    const first = body.indexOf('<article className="b">Second</article>');
    expect(body[first + 1]).toBe('<article className="b">Second</article>');
  });
});

describe('move', () => {
  it('moves an element up past its sibling', () => {
    const { content } = applyStructuralEdits(LIST, 'src/Features.jsx', [
      op({ op: 'move-up' }),
    ]);
    const body = lines(content);
    expect(body.indexOf('<article className="b">Second</article>')).toBeLessThan(
      body.indexOf('<article className="a">First</article>')
    );
  });

  it('moves an element down past its sibling', () => {
    const { content } = applyStructuralEdits(LIST, 'src/Features.jsx', [
      op({ op: 'move-down' }),
    ]);
    const body = lines(content);
    expect(body.indexOf('<article className="c">Third</article>')).toBeLessThan(
      body.indexOf('<article className="b">Second</article>')
    );
  });

  it('refuses to move the first element up', () => {
    const { failed } = applyStructuralEdits(LIST, 'src/Features.jsx', [
      op({ op: 'move-up', sourceLine: 4 }),
    ]);
    expect(failed[0].reason).toMatch(/would fall outside its siblings/);
  });

  it('refuses to move the last element down', () => {
    const { failed } = applyStructuralEdits(LIST, 'src/Features.jsx', [
      op({ op: 'move-down', sourceLine: 6 }),
    ]);
    expect(failed[0].reason).toMatch(/would fall outside its siblings/);
  });
});

describe('safety', () => {
  it('refuses when the element is not where it was said to be', () => {
    const { failed, content } = applyStructuralEdits(LIST, 'src/Features.jsx', [
      op({ op: 'delete', sourceLine: 99 }),
    ]);
    expect(failed[0].reason).toMatch(/Could not find the element/);
    expect(content).toBe(LIST);
  });

  it('rejects an unknown operation', () => {
    const { failed } = applyStructuralEdits(LIST, 'src/Features.jsx', [
      op({ op: 'explode' }),
    ]);
    expect(failed[0].reason).toMatch(/Unknown structural operation/);
  });

  it('refuses two operations that overlap', () => {
    const { applied, failed } = applyStructuralEdits(LIST, 'src/Features.jsx', [
      op({ op: 'delete' }),
      op({ op: 'duplicate' }),
    ]);
    expect(applied).toHaveLength(1);
    expect(failed[0].reason).toMatch(/overlap/);
  });
});

describe('dispatch', () => {
  it('routes structural operations', () => {
    const { content, applied } = applyEditsToFile({
      content: LIST,
      filePath: 'src/Features.jsx',
      edits: [op({ op: 'delete' })],
    });
    expect(applied).toHaveLength(1);
    expect(content).not.toContain('Second');
  });

  it('applies a text edit and a structural edit to one file', () => {
    const { content, applied } = applyEditsToFile({
      content: LIST,
      filePath: 'src/Features.jsx',
      edits: [
        { sourceFile: 'src/Features.jsx', originalText: 'First', newText: 'Primero', sourceLine: 4 },
        op({ op: 'delete', sourceLine: 6 }),
      ],
    });
    expect(applied).toHaveLength(2);
    expect(content).toContain('Primero');
    expect(content).not.toContain('Third');
  });
});

describe('moving several places at once', () => {
  it('honours a signed offset', () => {
    // Repeated nudges used to collide on one key and silently do nothing.
    const { content } = applyStructuralEdits(LIST, 'src/Features.jsx', [
      op({ op: 'move', moveBy: 2, sourceLine: 4 }),
    ]);
    const body = lines(content);
    expect(body.indexOf('<article className="a">First</article>')).toBeGreaterThan(
      body.indexOf('<article className="c">Third</article>')
    );
  });

  it('refuses an offset that runs off the end', () => {
    const { failed } = applyStructuralEdits(LIST, 'src/Features.jsx', [
      op({ op: 'move', moveBy: 5, sourceLine: 4 }),
    ]);
    expect(failed[0].reason).toMatch(/would fall outside/);
  });

  it('treats a zero offset as no change', () => {
    const { failed } = applyStructuralEdits(LIST, 'src/Features.jsx', [
      op({ op: 'move', moveBy: 0 }),
    ]);
    expect(failed[0].reason).toMatch(/already where it started/);
  });
});

describe('html structural edits', () => {
  const HTML = `<section>
  <article class="a">First</article>
  <article class="b">Second</article>
  <article class="c">Third</article>
</section>
`;

  const hop = (over) => ({ sourceFile: 'app.html', sourceLine: 3, ...over });

  it('deletes an element', () => {
    const { content, applied } = applyHtmlStructuralEdits(HTML, 'app.html', [
      hop({ op: 'delete' }),
    ]);
    expect(applied).toHaveLength(1);
    expect(content).not.toContain('Second');
    expect(content).toContain('First');
    expect(content).toContain('Third');
  });

  it('duplicates an element', () => {
    const { content } = applyHtmlStructuralEdits(HTML, 'app.html', [hop({ op: 'duplicate' })]);
    expect(content.match(/Second/g)).toHaveLength(2);
  });

  it('moves an element up', () => {
    const { content } = applyHtmlStructuralEdits(HTML, 'app.html', [hop({ op: 'move-up' })]);
    const body = lines(content);
    expect(body.indexOf('<article class="b">Second</article>')).toBeLessThan(
      body.indexOf('<article class="a">First</article>')
    );
  });

  it('refuses when the element is not where it was said to be', () => {
    const { failed, content } = applyHtmlStructuralEdits(HTML, 'app.html', [
      hop({ op: 'delete', sourceLine: 99 }),
    ]);
    expect(failed).toHaveLength(1);
    expect(content).toBe(HTML);
  });

  it('handles nested elements of the same tag', () => {
    // The old scanner took the first </div>, so the outer element's range
    // stopped inside itself and a delete removed the wrong span of text.
    const nested = `<main>\n  <div class="outer">a <div class="inner">b</div> c</div>\n  <div class="after">keep</div>\n</main>\n`;
    const { content } = applyHtmlStructuralEdits(nested, 'a.html', [
      { sourceFile: 'a.html', sourceLine: 2, op: 'delete' },
    ]);
    expect(content).not.toContain('outer');
    expect(content).not.toContain('inner');
    expect(content).toContain('<div class="after">keep</div>');
  });
});

describe('routing by file type', () => {
  const markup = `<section>\n  <p>One</p>\n  <p>Two</p>\n</section>\n`;

  it.each(['app.html', 'App.svelte'])('uses the markup backend for %s', (file) => {
    // These used to be parsed as JSX, which threw and reported every
    // structural edit as failed.
    const { content, applied, failed } = applyEditsToFile({
      content: markup,
      filePath: file,
      edits: [{ sourceFile: file, sourceLine: 2, op: 'delete' }],
    });
    expect(failed).toHaveLength(0);
    expect(applied).toHaveLength(1);
    expect(content).not.toContain('One');
    expect(content).toContain('Two');
  });

  it('uses the Vue backend for a single-file component', () => {
    // A .vue file is not bare markup: the scanner must be confined to the
    // template block so it cannot match inside <script>.
    const sfc = `<template>\n  <section>\n    <p>One</p>\n    <p>Two</p>\n  </section>\n</template>\n`;
    const { content, applied, failed } = applyEditsToFile({
      content: sfc,
      filePath: 'App.vue',
      edits: [{ sourceFile: 'App.vue', sourceLine: 3, op: 'delete' }],
    });
    expect(failed).toHaveLength(0);
    expect(applied).toHaveLength(1);
    expect(content).not.toContain('One');
    expect(content).toContain('Two');
  });

  it('still uses the JSX backend for components', () => {
    const { applied } = applyEditsToFile({
      content: LIST,
      filePath: 'src/Features.jsx',
      edits: [op({ op: 'delete' })],
    });
    expect(applied).toHaveLength(1);
  });
});
