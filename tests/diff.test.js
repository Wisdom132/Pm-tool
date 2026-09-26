// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { diffWords, tokenize, renderDiff } from '../inline-edit-tool/extension/src/ui/diff.js';

const text = (parts, type) =>
  parts.filter((p) => p.type === type).map((p) => p.value).join('');

describe('tokenize', () => {
  it('keeps whitespace so the text can be rebuilt exactly', () => {
    expect(tokenize('a  b').join('')).toBe('a  b');
  });

  it('handles empty input', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('diffWords', () => {
  it('marks only the word that changed', () => {
    const parts = diffWords('Build things that mater', 'Build things that matter');
    expect(text(parts, 'removed')).toBe('mater');
    expect(text(parts, 'added')).toBe('matter');
    expect(text(parts, 'same')).toContain('Build things that');
  });

  it('reports no change for identical text', () => {
    const parts = diffWords('Same text', 'Same text');
    expect(parts.every((p) => p.type === 'same')).toBe(true);
  });

  it('handles a pure addition', () => {
    const parts = diffWords('Hello', 'Hello there');
    expect(text(parts, 'removed')).toBe('');
    expect(text(parts, 'added').trim()).toBe('there');
  });

  it('handles a pure removal', () => {
    const parts = diffWords('Hello there', 'Hello');
    expect(text(parts, 'added')).toBe('');
    expect(text(parts, 'removed').trim()).toBe('there');
  });

  it('handles a complete rewrite', () => {
    const parts = diffWords('One', 'Two');
    expect(text(parts, 'removed')).toBe('One');
    expect(text(parts, 'added')).toBe('Two');
  });

  it('reconstructs both sides exactly', () => {
    const before = 'The fastest way to ship high-quality products';
    const after = 'The quickest way to ship great products';
    const parts = diffWords(before, after);
    expect(text(parts, 'same') + '' !== '').toBe(true);
    expect(
      parts.filter((p) => p.type !== 'added').map((p) => p.value).join('')
    ).toBe(before);
    expect(
      parts.filter((p) => p.type !== 'removed').map((p) => p.value).join('')
    ).toBe(after);
  });

  it('copes with empty sides', () => {
    expect(text(diffWords('', 'new'), 'added')).toBe('new');
    expect(text(diffWords('old', ''), 'removed')).toBe('old');
  });

  it('merges genuinely adjacent parts of the same type', () => {
    // "one two " is removed as one run, so it renders as one <mark>.
    const parts = diffWords('one two three', 'three');
    const removed = parts.filter((p) => p.type === 'removed');
    expect(removed).toHaveLength(1);
    expect(removed[0].value).toBe('one two ');
  });

  it('keeps shared whitespace shared', () => {
    // Every word differs but the spaces between them do not, so the diff
    // stays word-level instead of collapsing to one big replacement.
    const parts = diffWords('a b c', 'x y z');
    expect(parts.filter((p) => p.type === 'removed')).toHaveLength(3);
    expect(text(parts, 'same')).toBe('  ');
  });
});

describe('renderDiff', () => {
  it('shows only its own side of the change', () => {
    const parts = diffWords('Build things that mater', 'Build things that matter');

    const removed = document.createElement('td');
    renderDiff(removed, parts, 'removed');
    expect(removed.textContent).toBe('Build things that mater');

    const added = document.createElement('td');
    renderDiff(added, parts, 'added');
    expect(added.textContent).toBe('Build things that matter');
  });

  it('marks the changed words', () => {
    const parts = diffWords('old text', 'new text');
    const cell = document.createElement('td');
    renderDiff(cell, parts, 'added');

    const marks = cell.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('new');
    expect(marks[0].className).toBe('__iet-diff-added');
  });

  it('clears previous content', () => {
    const cell = document.createElement('td');
    cell.textContent = 'stale';
    renderDiff(cell, diffWords('a', 'b'), 'added');
    expect(cell.textContent).toBe('b');
  });
});
