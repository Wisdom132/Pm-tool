// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  horizontalPlacement,
  placeCard,
  railBounds,
  verticalPlacement,
} from '../inline-edit-tool/extension/src/ui/placement.js';

/**
 * Placing a floating card.
 *
 * The bug this replaces: both panels clamped their left edge to 8px to stay
 * inside the viewport. The rail is docked at 12px, so "inside the viewport"
 * put the card *underneath the toolbar* and covered every row label. The
 * clamp was not wrong about the screen — it did not know the rail existed.
 */
const rail = { left: 12, right: 110, width: 98, height: 600, top: 100, bottom: 700 };

describe('horizontalPlacement', () => {
  it('clears a rail docked on the left', () => {
    // The regression. Preferred position is 0, which is behind the rail.
    expect(horizontalPlacement(0, 262, 1440, rail)).toBe(118);
  });

  it('clears a rail docked on the right', () => {
    const right = { left: 1330, right: 1428, width: 98, top: 100, bottom: 700, height: 600 };
    // The card's right edge must land left of the rail: 1330 - 8 - 262.
    expect(horizontalPlacement(1400, 262, 1440, right)).toBe(1060);
  });

  it('lines up with the element when there is room', () => {
    expect(horizontalPlacement(400, 262, 1440, rail)).toBe(400);
  });

  it('keeps the card inside the right edge', () => {
    expect(horizontalPlacement(1400, 262, 1440, rail)).toBe(1440 - 262 - 8);
  });

  it('prefers covering the page over hiding under the rail', () => {
    // A narrow viewport where the card cannot both clear the rail and fit.
    // Half a card under the toolbar is unreadable; one pushed off its
    // element is merely imprecise.
    const placed = horizontalPlacement(0, 262, 300, rail);
    expect(placed).toBe(118);
  });

  it('uses the whole width when there is no rail', () => {
    expect(horizontalPlacement(0, 262, 1440, null)).toBe(8);
  });
});

describe('verticalPlacement', () => {
  const rect = (top, bottom) => ({ top, bottom });

  it('opens below the element when it fits', () => {
    expect(verticalPlacement(rect(100, 140), 200, 900)).toBe(148);
  });

  it('flips above when there is no room below', () => {
    expect(verticalPlacement(rect(600, 700), 200, 900)).toBe(392);
  });

  it('never returns a negative top', () => {
    // A card taller than the viewport would otherwise start off the top of
    // the screen, putting its first rows out of reach entirely — which is
    // what a long panel does on a short window.
    expect(verticalPlacement(rect(100, 140), 2000, 900)).toBe(8);
  });

  it('pins to the bottom when it fits neither way but still fits on screen', () => {
    expect(verticalPlacement(rect(10, 880), 300, 900)).toBe(592);
  });
});

describe('railBounds', () => {
  let root;
  let card;

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    // Closed, as the real host is. `getRootNode()` reaches it from inside
    // regardless of mode, and matching production is what keeps this test
    // honest about the lookup actually being possible.
    root = host.attachShadow({ mode: 'closed' });

    card = document.createElement('div');
    root.appendChild(card);
  });

  const addRail = (box) => {
    const el = document.createElement('div');
    el.id = '__iet-rail';
    el.getBoundingClientRect = () => box;
    root.appendChild(el);
    return el;
  };

  it('finds the rail through the card’s own root', () => {
    addRail(rail);
    expect(railBounds(card)).toMatchObject({ right: 110 });
  });

  it('ignores a hidden rail', () => {
    // Somebody who closed the toolbar should get the whole width back.
    addRail(rail).hidden = true;
    expect(railBounds(card)).toBeNull();
  });

  it('ignores a rail with no box', () => {
    addRail({ left: 0, right: 0, width: 0, height: 0, top: 0, bottom: 0 });
    expect(railBounds(card)).toBeNull();
  });

  it('copes with no rail at all', () => {
    expect(railBounds(card)).toBeNull();
  });
});

describe('placeCard', () => {
  it('writes both coordinates, clear of the rail', () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'closed' });

    const railEl = document.createElement('div');
    railEl.id = '__iet-rail';
    railEl.getBoundingClientRect = () => rail;
    root.appendChild(railEl);

    const card = document.createElement('div');
    root.appendChild(card);

    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ top: 100, bottom: 140, left: 0, right: 200 });
    document.body.appendChild(el);

    // happy-dom lays nothing out, so the fallback size is what gets used —
    // which is exactly the first-open case the fallback exists for.
    placeCard(card, el, { width: 262, height: 280 }, { innerWidth: 1440, innerHeight: 900 });

    expect(card.style.left).toBe('118px');
    expect(card.style.top).toBe('148px');
  });
});
