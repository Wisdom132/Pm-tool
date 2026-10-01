"use strict";

// ============================================================
//  Placing a floating card
//
//  Every panel here opens beside the element it describes, and
//  every one of them has to solve the same three problems: stay
//  inside the viewport, stay clear of the rail, and stay
//  readable when it is taller than the screen.
//
//  It used to be solved twice, slightly differently, by
//  clamping the card's left edge to 8px. The rail is docked at
//  12px — so "clamp to the edge of the screen" put the card
//  *underneath the toolbar*, and the row labels were covered by
//  it. The number was never wrong in isolation; it was wrong
//  because it did not know the rail was there.
// ============================================================

const P = "__iet";

/** Breathing room between a card and whatever it is avoiding. */
const GAP = 8;

/**
 * The rail's box, if it is on screen.
 *
 * Found through the card's own root rather than passed in, because every
 * caller is already mounted in the same shadow root and threading the rail
 * through each of them is a parameter nobody would remember to pass.
 */
export function railBounds(card) {
  const root = card?.getRootNode?.();
  const rail = root?.querySelector?.(`#${P}-rail`);
  if (!rail || rail.hidden) return null;

  const rect = rail.getBoundingClientRect();
  // A zero-size rail is a hidden one; avoiding it would push every card
  // against the left edge for no reason.
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

/**
 * Where a card's left edge should sit.
 *
 * Prefers to line up with the element it describes, then gives way to the
 * viewport, then to the rail. The rail wins outright when there is no room
 * for both: a card half under the toolbar is unreadable, whereas one pushed
 * a little off its element is merely imprecise.
 */
export function horizontalPlacement(preferred, width, viewportWidth, rail) {
  let min = GAP;
  let max = viewportWidth - width - GAP;

  if (rail) {
    // Which side the rail is docked to decides which bound it moves.
    const onLeft = rail.left + rail.width / 2 < viewportWidth / 2;
    if (onLeft) min = Math.max(min, rail.right + GAP);
    else max = Math.min(max, rail.left - GAP - width);
  }

  if (max < min) return min;
  return Math.max(min, Math.min(preferred, max));
}

/**
 * Where a card's top edge should sit, given how tall it is.
 *
 * Below the element when it fits, above when it does not, and pinned to the
 * top once the card is taller than the space either way — at which point the
 * card's own scrolling takes over. Returning a negative top would hide the
 * first rows off the top of the screen with no way to reach them.
 */
export function verticalPlacement(rect, height, viewportHeight) {
  const below = rect.bottom + GAP;
  if (below + height <= viewportHeight - GAP) return below;

  const above = rect.top - height - GAP;
  if (above >= GAP) return above;

  return Math.max(GAP, viewportHeight - height - GAP);
}

/**
 * Position a card beside an element.
 *
 * @param {HTMLElement} card      must already be visible, or it measures zero
 * @param {Element} el            what the card is describing
 * @param {{width:number, height:number}} [fallback] used when the card has
 *        not been laid out yet, so the first open is not placed at 0,0
 */
export function placeCard(card, el, fallback = {}, win = window) {
  const rect = el.getBoundingClientRect();
  const width = card.offsetWidth || fallback.width || 260;
  const height = card.offsetHeight || fallback.height || 280;

  card.style.top = `${verticalPlacement(rect, height, win.innerHeight)}px`;
  card.style.left = `${horizontalPlacement(rect.left, width, win.innerWidth, railBounds(card))}px`;
}
