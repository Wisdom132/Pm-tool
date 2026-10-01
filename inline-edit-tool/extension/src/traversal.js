"use strict";

// ============================================================
//  Walking the page by keyboard
//
//  Taken from VisBug, which binds tab/shift+tab to siblings and
//  enter/shift+enter to children and parents. It is the single
//  best thing in that codebase: once the pointer has got you
//  near, the keyboard gets you exactly where you meant, and you
//  can traverse a whole page without hunting for a 3px gap
//  between two nested divs.
//
//  Our breadcrumb already walks *up*. This adds sideways and
//  down, and makes all of it reachable without the mouse.
//
//  Pure functions over a node and a predicate, so the rules are
//  testable without a page: what counts as a candidate is the
//  caller's business, because it differs per tool — Edit only
//  wants text-bearing elements, Inspect wants anything.
// ============================================================

/**
 * Our own UI must never be a destination.
 *
 * Checked by *containment in the shadow host*, not by looking for an
 * `__iet-` class. Those classes are deliberately applied to the host page's
 * own elements — `__iet-editable`, `__iet-hovered` — so a class test marks
 * every decorated element as ours and traversal stops dead on exactly the
 * elements it exists to move between. It read as "Tab does nothing", and
 * only on a page where a tool had already decorated something.
 */
const HOST_ID = "__iet-root";

function isOurs(el) {
  return Boolean(el?.closest?.(`#${HOST_ID}`)) || el?.id === HOST_ID;
}

/**
 * Is this element a place the keyboard should be able to land?
 *
 * Invisible elements are skipped — tabbing into something with no box is
 * indistinguishable from the key not working.
 */
function isReachable(el, accepts) {
  if (!el || el.nodeType !== 1 || isOurs(el)) return false;
  if (!accepts(el)) return false;

  const rect = el.getBoundingClientRect?.();
  return !rect || rect.width > 0 || rect.height > 0;
}

/**
 * The next sibling the keyboard should move to.
 *
 * Skips past unreachable siblings rather than stopping at them, so a
 * wrapper with no box does not become a dead end.
 *
 * @param {number} direction +1 forward, -1 back
 */
export function siblingFrom(el, direction, accepts = () => true) {
  let node = direction > 0 ? el?.nextElementSibling : el?.previousElementSibling;

  while (node) {
    if (isReachable(node, accepts)) return node;
    node = direction > 0 ? node.nextElementSibling : node.previousElementSibling;
  }

  // No reachable sibling at this level. Deliberately *not* wrapping to the
  // parent's siblings: a key that silently changes level is a key nobody
  // can predict.
  return null;
}

/**
 * The first child worth descending into.
 *
 * Depth-first past unreachable wrappers, because a `<div>` that exists only
 * to hold a class is not somewhere anybody wants to stop.
 */
export function childFrom(el, accepts = () => true) {
  if (!el?.children) return null;

  for (const child of el.children) {
    if (isReachable(child, accepts)) return child;

    const deeper = childFrom(child, accepts);
    if (deeper) return deeper;
  }
  return null;
}

/** The nearest ancestor worth stopping at. */
export function parentFrom(el, accepts = () => true) {
  let node = el?.parentElement;

  while (node && node !== document.body && node !== document.documentElement) {
    if (isReachable(node, accepts)) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Resolve one keystroke into a destination.
 *
 * The mapping is VisBug's, and it is a good one because it matches how the
 * DOM is shaped rather than how the screen is laid out: tab moves along a
 * level, enter moves between levels.
 *
 * @returns {{el: Element, how: string}|null} `how` describes the move, for
 *          a hint the person can read — a silent no-op is the thing that
 *          makes keyboard navigation feel broken
 */
export function traverse(el, key, { shift = false, accepts = () => true } = {}) {
  if (!el) return null;

  if (key === "Tab") {
    const found = siblingFrom(el, shift ? -1 : 1, accepts);
    return found ? { el: found, how: shift ? "previous sibling" : "next sibling" } : null;
  }

  if (key === "Enter") {
    const found = shift ? parentFrom(el, accepts) : childFrom(el, accepts);
    return found ? { el: found, how: shift ? "parent" : "first child" } : null;
  }

  return null;
}
