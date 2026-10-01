// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  compatible,
  createSelection,
  partition,
} from '../inline-edit-tool/extension/src/selection.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

const el = (html) => {
  document.body.insertAdjacentHTML('beforeend', html);
  return document.body.lastElementChild;
};

describe('createSelection', () => {
  it('replaces on a plain pick and accumulates on toggle', () => {
    const s = createSelection();
    const a = el('<p>a</p>');
    const b = el('<p>b</p>');

    s.set(a);
    expect(s.items).toEqual([a]);

    s.toggle(b);
    expect(s.items).toEqual([a, b]);

    s.set(b);
    expect(s.items).toEqual([b]);
  });

  it('toggles an already-selected element back out', () => {
    // A mis-click is undone by the gesture that made it, which is the only
    // thing anybody guesses.
    const s = createSelection();
    const a = el('<p>a</p>');

    s.toggle(a);
    s.toggle(a);
    expect(s.items).toEqual([]);
  });

  it('keeps the first pick as the anchor', () => {
    // Everything else is judged against it, so insertion order matters.
    const s = createSelection();
    const a = el('<p>a</p>');
    const b = el('<p>b</p>');

    s.set(a);
    s.toggle(b);
    expect(s.anchor).toBe(a);
  });

  it('drops elements the page has removed', () => {
    // A framework re-render replaces nodes. A selection holding detached
    // elements would apply edits to things nobody can see.
    const s = createSelection();
    const a = el('<p>a</p>');
    const b = el('<p>b</p>');

    s.set(a);
    s.toggle(b);
    b.remove();

    expect(s.items).toEqual([a]);
    expect(s.size).toBe(1);
  });

  it('notifies subscribers with a copy', () => {
    const s = createSelection();
    const seen = vi.fn();
    s.subscribe(seen);

    const a = el('<p>a</p>');
    s.set(a);

    expect(seen).toHaveBeenCalledWith([a]);
    // Mutating what a subscriber received must not corrupt the selection.
    seen.mock.calls[0][0].push(el('<p>b</p>'));
    expect(s.size).toBe(1);
  });

  it('stops notifying once unsubscribed', () => {
    const s = createSelection();
    const seen = vi.fn();
    const off = s.subscribe(seen);
    off();

    s.set(el('<p>a</p>'));
    expect(seen).not.toHaveBeenCalled();
  });

  it('does not notify when clearing an empty selection', () => {
    const s = createSelection();
    const seen = vi.fn();
    s.subscribe(seen);

    s.clear();
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('compatible', () => {
  const classOf = (e) => e.className;

  it('accepts two of the same kind at the same starting value', () => {
    const a = el('<div class="p-4">a</div>');
    const b = el('<div class="p-4">b</div>');
    expect(compatible(a, b, classOf)).toBe(true);
  });

  it('refuses different tags', () => {
    const a = el('<div class="p-4">a</div>');
    const b = el('<span class="p-4">b</span>');
    expect(compatible(a, b, classOf)).toBe(false);
  });

  it('refuses different starting values', () => {
    // "One more step of padding" across elements starting at different
    // values gives different results from one gesture — which reads as a
    // bug, and lands as unrelated-looking hunks in the diff.
    const a = el('<div class="p-4">a</div>');
    const b = el('<div class="p-8">b</div>');
    expect(compatible(a, b, classOf)).toBe(false);
  });
});

describe('partition', () => {
  const classOf = (e) => e.className;

  it('splits into what can change and what cannot', () => {
    const a = el('<div class="p-4">a</div>');
    const b = el('<div class="p-4">b</div>');
    const c = el('<div class="p-8">c</div>');

    const { apply, skipped } = partition([a, b, c], classOf);
    expect(apply).toEqual([a, b]);
    expect(skipped).toEqual([c]);
  });

  it('always includes the anchor', () => {
    const a = el('<div class="p-4">a</div>');
    expect(partition([a], classOf).apply).toEqual([a]);
  });

  it('reports the skipped ones rather than hiding them', () => {
    // Somebody who selected six things and changed four needs telling, or
    // they will believe all six moved.
    const a = el('<div class="p-4">a</div>');
    const odd = el('<span class="p-4">b</span>');

    expect(partition([a, odd], classOf).skipped).toEqual([odd]);
  });

  it('handles an empty selection', () => {
    expect(partition([], classOf)).toEqual({ apply: [], skipped: [] });
  });
});
