"use strict";

// ============================================================
//  Multi-select
//
//  Shift-click accumulates, and a tool then acts on all of it.
//  VisBug's model, and the reason their design tools feel fast:
//  changing the padding on six cards is one gesture, not six.
//
//  It matters more here than it does there, because every one
//  of our changes becomes a line in a pull request. Six separate
//  edits to six cards is six diff hunks a reviewer reads one at
//  a time; one gesture that touches six is still six hunks, but
//  it is one decision, made once, consistently. The inconsistent
//  version is what happens when somebody does five of them by
//  hand and misses the sixth.
//
//  Deliberately *not* a set of arbitrary elements with no
//  relationship: see `compatible`.
// ============================================================

export function createSelection() {
  /** Insertion order matters: the first pick is the one others are judged against. */
  let items = [];
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) fn(items.slice());
  }

  function prune() {
    const live = items.filter((el) => el.isConnected);
    if (live.length !== items.length) {
      items = live;
      return true;
    }
    return false;
  }

  return {
    /** @returns {Element[]} a copy — callers must not mutate the selection by accident */
    get items() {
      prune();
      return items.slice();
    },

    get size() {
      prune();
      return items.length;
    },

    /** The element everything else was added relative to. */
    get anchor() {
      prune();
      return items[0] ?? null;
    },

    has(el) {
      return items.includes(el);
    },

    /** Replace the selection with one element. */
    set(el) {
      items = el ? [el] : [];
      notify();
    },

    /**
     * Shift-click behaviour: add, or remove if already there.
     *
     * Toggling rather than only adding means a mis-click is undone the same
     * way it was made, which is the only gesture anybody guesses.
     */
    toggle(el) {
      if (!el) return;

      const at = items.indexOf(el);
      if (at === -1) items.push(el);
      else items.splice(at, 1);

      notify();
    },

    clear() {
      if (!items.length) return;
      items = [];
      notify();
    },

    /** Called whenever the selection changes, with a copy of it. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/**
 * May these two elements be changed together?
 *
 * A guard, not a convenience. The tools that act on a selection write
 * *classes*, and applying "one more step of padding" across elements that do
 * not share a starting value produces six different results from one
 * gesture — which looks like a bug, and lands in the pull request as six
 * unrelated-looking changes.
 *
 * Requiring the same tag and the same starting value for the property being
 * changed keeps a multi-edit meaning what it looks like it means.
 *
 * @param {Element} a  the anchor
 * @param {Element} b  a candidate
 * @param {(el: Element) => string|null} valueOf  the property's current value
 */
export function compatible(a, b, valueOf) {
  if (!a || !b) return false;
  if (a.tagName !== b.tagName) return false;

  return valueOf(a) === valueOf(b);
}

/**
 * Split a selection into the part a change can safely apply to, and the rest.
 *
 * Returning both halves rather than silently filtering: somebody who
 * selected six things and changed four of them needs to be told, or they
 * will believe all six moved.
 */
export function partition(elements, valueOf) {
  const [anchor, ...rest] = elements;
  if (!anchor) return { apply: [], skipped: [] };

  const apply = [anchor];
  const skipped = [];

  for (const el of rest) {
    if (compatible(anchor, el, valueOf)) apply.push(el);
    else skipped.push(el);
  }

  return { apply, skipped };
}
