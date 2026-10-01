// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  childFrom,
  parentFrom,
  siblingFrom,
  traverse,
} from '../inline-edit-tool/extension/src/traversal.js';

/**
 * Keyboard traversal, taken from VisBug.
 *
 * Tab moves along a level, enter moves between levels. The rules matter
 * because a key that silently does nothing is the thing that makes keyboard
 * navigation feel broken — every case below is one where the naive
 * implementation stops when it should keep going, or moves when it should
 * stop.
 */
function mount(html) {
  document.body.innerHTML = html;
  // happy-dom reports no layout, so give everything a box unless a test
  // says otherwise. Without this every element reads as invisible.
  for (const el of document.body.querySelectorAll('*')) {
    if (!el.getBoundingClientRect.__patched) {
      el.getBoundingClientRect = () => ({ width: 10, height: 10 });
      el.getBoundingClientRect.__patched = true;
    }
  }
  return document.body;
}

const hide = (el) => {
  el.getBoundingClientRect = () => ({ width: 0, height: 0 });
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('siblingFrom', () => {
  it('moves forward and back', () => {
    mount('<p id="a">a</p><p id="b">b</p><p id="c">c</p>');
    const b = document.getElementById('b');

    expect(siblingFrom(b, 1).id).toBe('c');
    expect(siblingFrom(b, -1).id).toBe('a');
  });

  it('skips past a sibling with no box', () => {
    // A wrapper with no geometry is not a destination; stopping at it makes
    // the key appear to do nothing.
    mount('<p id="a">a</p><span id="gap"></span><p id="c">c</p>');
    hide(document.getElementById('gap'));

    expect(siblingFrom(document.getElementById('a'), 1).id).toBe('c');
  });

  it('returns null at the end rather than wrapping', () => {
    mount('<p id="a">a</p><p id="b">b</p>');
    expect(siblingFrom(document.getElementById('b'), 1)).toBeNull();
    expect(siblingFrom(document.getElementById('a'), -1)).toBeNull();
  });

  it('does not climb to the parent level', () => {
    // A key that silently changes level is a key nobody can predict.
    mount('<div><p id="only">x</p></div><div id="next">y</div>');
    expect(siblingFrom(document.getElementById('only'), 1)).toBeNull();
  });

  it('honours the callerrule for what counts', () => {
    mount('<p id="a">a</p><span id="b">b</span><p id="c">c</p>');
    const onlyP = (el) => el.tagName === 'P';

    expect(siblingFrom(document.getElementById('a'), 1, onlyP).id).toBe('c');
  });
});

describe('childFrom', () => {
  it('finds the first child', () => {
    mount('<div id="p"><span id="a">a</span><span id="b">b</span></div>');
    expect(childFrom(document.getElementById('p')).id).toBe('a');
  });

  it('descends past a wrapper that is not worth stopping at', () => {
    // A div that exists only to hold a class should not be a destination.
    mount('<div id="p"><div id="w"><span id="deep">x</span></div></div>');
    const onlySpan = (el) => el.tagName === 'SPAN';

    expect(childFrom(document.getElementById('p'), onlySpan).id).toBe('deep');
  });

  it('returns null for a leaf', () => {
    mount('<p id="leaf">text</p>');
    expect(childFrom(document.getElementById('leaf'))).toBeNull();
  });
});

describe('parentFrom', () => {
  it('finds the nearest ancestor', () => {
    mount('<section id="s"><div id="d"><p id="p">x</p></div></section>');
    expect(parentFrom(document.getElementById('p')).id).toBe('d');
  });

  it('skips ancestors the caller does not want', () => {
    mount('<section id="s"><div id="d"><p id="p">x</p></div></section>');
    const onlySection = (el) => el.tagName === 'SECTION';

    expect(parentFrom(document.getElementById('p'), onlySection).id).toBe('s');
  });

  it('stops at body rather than selecting it', () => {
    // Selecting <body> is never what anybody meant, and every tool would
    // then be pointed at the whole page.
    mount('<p id="p">x</p>');
    expect(parentFrom(document.getElementById('p'))).toBeNull();
  });
});

describe('traverse', () => {
  beforeEach(() => {
    mount('<div id="p"><p id="a">a</p><p id="b">b</p></div>');
  });

  it('maps tab to siblings and enter to levels', () => {
    const a = document.getElementById('a');

    expect(traverse(a, 'Tab').el.id).toBe('b');
    expect(traverse(document.getElementById('b'), 'Tab', { shift: true }).el.id).toBe('a');
    expect(traverse(a, 'Enter', { shift: true }).el.id).toBe('p');
    expect(traverse(document.getElementById('p'), 'Enter').el.id).toBe('a');
  });

  it('names the move, so a hint can say what happened', () => {
    expect(traverse(document.getElementById('a'), 'Tab').how).toBe('next sibling');
    expect(traverse(document.getElementById('a'), 'Enter', { shift: true }).how).toBe('parent');
  });

  it('returns null when there is nowhere to go', () => {
    expect(traverse(document.getElementById('b'), 'Tab')).toBeNull();
    expect(traverse(document.getElementById('a'), 'Enter')).toBeNull();
  });

  it('ignores keys it does not handle', () => {
    expect(traverse(document.getElementById('a'), 'ArrowDown')).toBeNull();
  });

  it('never lands on our own UI', () => {
    mount('<p id="a">a</p><div id="__iet-root"><div>ours</div></div><p id="c">c</p>');
    expect(siblingFrom(document.getElementById('a'), 1).id).toBe('c');
  });

  it('still traverses page elements our tools have decorated', () => {
    // The regression: "ours" was once decided by looking for an `__iet-`
    // class, and those are applied to the *page's* elements —
    // `__iet-editable`, `__iet-hovered`. So every decorated element counted
    // as ours and Tab stopped dead on exactly the elements it exists to
    // move between. It only showed up once a tool had decorated the page,
    // which is why a browser found it and the first unit tests did not.
    mount('<p id="a" class="__iet-editable">a</p><p id="b" class="__iet-editable __iet-hovered">b</p>');
    expect(siblingFrom(document.getElementById('a'), 1).id).toBe('b');
  });
});
