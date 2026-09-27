import { describe, it, expect } from 'vitest';
import { applyVueEdits } from '../overlay/pr-service/lib/codemod/vue.js';
import { applyEditsToFile } from '../overlay/pr-service/lib/codemod/index.js';

const SFC = `<script setup>
const label = 'First item';
</script>

<template>
  <section class="list">
    <p>First item</p>
    <p>Second item</p>
    <span>{{ dynamic }}</span>
  </section>
</template>

<style scoped>
.list { color: red; }
</style>
`;

// <p>First item</p> is line 7 of the file.
const edit = (over) => ({
  sourceFile: 'App.vue',
  sourceLine: 7,
  originalText: 'First item',
  newText: 'Changed item',
  ...over,
});

describe('vue text edits', () => {
  it('rewrites text in the template', () => {
    const { content, applied } = applyVueEdits(SFC, 'App.vue', [edit()]);
    expect(applied).toHaveLength(1);
    expect(content).toContain('<p>Changed item</p>');
  });

  it('leaves the script block alone', () => {
    // The same string appears in <script>. A blind text replace — which is
    // what the broken require() fallback did — would have hit it.
    const { content } = applyVueEdits(SFC, 'App.vue', [edit()]);
    expect(content).toContain("const label = 'First item';");
  });

  it('leaves the style block alone', () => {
    const { content } = applyVueEdits(SFC, 'App.vue', [edit()]);
    expect(content).toContain('.list { color: red; }');
  });

  it('reports file line numbers, not template-relative ones', () => {
    // The annotation plugin emits file lines; the codemod has to agree.
    const onTemplateRelativeLine = applyVueEdits(SFC, 'App.vue', [edit({ sourceLine: 2 })]);
    expect(onTemplateRelativeLine.applied[0]._match).not.toBe('exact');

    const onFileLine = applyVueEdits(SFC, 'App.vue', [edit({ sourceLine: 7 })]);
    expect(onFileLine.applied).toHaveLength(1);
  });

  it('disambiguates duplicates by file line', () => {
    const dup = `<template>\n  <p>Save</p>\n  <p>Save</p>\n</template>\n`;
    const { content } = applyVueEdits(dup, 'A.vue', [
      { sourceLine: 3, originalText: 'Save', newText: 'Store' },
    ]);
    expect(content).toBe(`<template>\n  <p>Save</p>\n  <p>Store</p>\n</template>\n`);
  });

  it('skips an interpolation', () => {
    const { failed } = applyVueEdits(SFC, 'App.vue', [
      edit({ originalText: '{{ dynamic }}', newText: 'static', sourceLine: 9 }),
    ]);
    expect(failed).toHaveLength(1);
  });

  it('changes nothing else in the file', () => {
    const { content } = applyVueEdits(SFC, 'App.vue', [edit()]);
    const before = SFC.split('\n');
    const after = content.split('\n');
    expect(after.length).toBe(before.length);
    after.forEach((line, i) => {
      if (!line.includes('Changed')) expect(line).toBe(before[i]);
    });
  });

  it('reports a missing template', () => {
    expect(() => applyVueEdits('<script>const a = 1;</script>', 'A.vue', [edit()])).toThrow(
      /no <template>/
    );
  });
});

describe('vue through the dispatcher', () => {
  it('uses the Vue backend, not the text fallback', () => {
    // A require() in this ESM module threw on every call, so the dispatcher
    // silently fell back to string replacement for every .vue file.
    const { content, applied, failed } = applyEditsToFile({
      content: SFC,
      filePath: 'App.vue',
      edits: [edit()],
    });
    expect(failed).toHaveLength(0);
    expect(applied).toHaveLength(1);
    expect(content).toContain("const label = 'First item';"); // script untouched
  });
});

describe('vue structural edits', () => {
  it('deletes an element from the template', () => {
    const { content, applied } = applyEditsToFile({
      content: SFC,
      filePath: 'App.vue',
      edits: [{ sourceFile: 'App.vue', sourceLine: 7, op: 'delete' }],
    });
    expect(applied).toHaveLength(1);
    expect(content).not.toContain('<p>First item</p>');
    expect(content).toContain('<p>Second item</p>');
  });

  it('keeps the script and style blocks intact', () => {
    const { content } = applyEditsToFile({
      content: SFC,
      filePath: 'App.vue',
      edits: [{ sourceFile: 'App.vue', sourceLine: 7, op: 'delete' }],
    });
    expect(content).toContain("const label = 'First item';");
    expect(content).toContain('.list { color: red; }');
  });

  it('moves an element down', () => {
    const { content } = applyEditsToFile({
      content: SFC,
      filePath: 'App.vue',
      edits: [{ sourceFile: 'App.vue', sourceLine: 7, op: 'move-down' }],
    });
    const body = content.split('\n').map((l) => l.trim());
    expect(body.indexOf('<p>Second item</p>')).toBeLessThan(body.indexOf('<p>First item</p>'));
  });

  it('duplicates an element', () => {
    const { content } = applyEditsToFile({
      content: SFC,
      filePath: 'App.vue',
      edits: [{ sourceFile: 'App.vue', sourceLine: 7, op: 'duplicate' }],
    });
    expect(content.match(/<p>First item<\/p>/g)).toHaveLength(2);
  });

  it('refuses when the element is not on the reported line', () => {
    const { failed, content } = applyEditsToFile({
      content: SFC,
      filePath: 'App.vue',
      edits: [{ sourceFile: 'App.vue', sourceLine: 99, op: 'delete' }],
    });
    expect(failed).toHaveLength(1);
    expect(content).toBe(SFC);
  });
});
