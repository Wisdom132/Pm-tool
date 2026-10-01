// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGuideLayer, nearMisses, segmentsBetween } from '../inline-edit-tool/extension/src/ui/guides.js';

describe('alignment guides', () => {
  let guides;
  let el;

  beforeEach(() => {
    guides = createGuideLayer();
    document.body.innerHTML = '';
    document.body.append(guides.element);

    el = document.createElement('h1');
    el.textContent = 'Hi';
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({
      top: 100, bottom: 140, left: 50, right: 300, width: 250, height: 40,
    });
  });

  const lines = () => guides.element.querySelectorAll('.__iet-guide');

  it('draws one line per edge', () => {
    expect(lines()).toHaveLength(4);
    expect(guides.element.querySelectorAll('.__iet-guide-h')).toHaveLength(2);
    expect(guides.element.querySelectorAll('.__iet-guide-v')).toHaveLength(2);
  });

  it('starts hidden', () => {
    expect(guides.element.hidden).toBe(true);
  });

  it('places lines on the element edges', () => {
    guides.show(el);
    const [top, bottom, left, right] = lines();
    expect(top.style.transform).toBe('translateY(100px)');
    expect(bottom.style.transform).toBe('translateY(140px)');
    expect(left.style.transform).toBe('translateX(50px)');
    expect(right.style.transform).toBe('translateX(300px)');
  });

  it('carries the state for colouring', () => {
    guides.show(el, 'selected');
    expect(guides.element.dataset.state).toBe('selected');
  });

  it('hides', () => {
    guides.show(el);
    guides.hide();
    expect(guides.element.hidden).toBe(true);
  });

  it('follows the element on reposition', () => {
    guides.show(el);
    el.getBoundingClientRect = () => ({ top: 10, bottom: 50, left: 5, right: 80 });
    guides.reposition(el);
    expect(lines()[0].style.transform).toBe('translateY(10px)');
  });

  it('does not reposition while hidden', () => {
    guides.show(el);
    guides.hide();
    el.getBoundingClientRect = () => ({ top: 999, bottom: 999, left: 999, right: 999 });
    guides.reposition(el);
    expect(lines()[0].style.transform).toBe('translateY(100px)');
  });

  it('stays away when disabled', () => {
    guides.setEnabled(false);
    guides.show(el);
    expect(guides.element.hidden).toBe(true);
  });

  it('hides immediately when disabled while visible', () => {
    guides.show(el);
    guides.setEnabled(false);
    expect(guides.element.hidden).toBe(true);
  });

  it('works again once re-enabled', () => {
    guides.setEnabled(false);
    guides.setEnabled(true);
    guides.show(el);
    expect(guides.element.hidden).toBe(false);
  });

  it('reports its enabled state', () => {
    expect(guides.enabled).toBe(true);
    guides.setEnabled(false);
    expect(guides.enabled).toBe(false);
  });

  it('ignores a missing element', () => {
    expect(() => guides.show(null)).not.toThrow();
    expect(guides.element.hidden).toBe(true);
  });
});

// ============================================================
//  Measurements
//
//  The number on the badge is the whole feature: a wrong
//  distance looks exactly as confident as a right one, so the
//  geometry is pure and every arrangement is pinned here.
// ============================================================
const rect = (left, top, width, height) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

describe('segmentsBetween', () => {
  it('measures the horizontal gap between side-by-side boxes', () => {
    const segments = segmentsBetween(rect(0, 0, 100, 50), rect(140, 0, 100, 50));
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ axis: 'h', x: 100, px: 40, length: 40 });
    // The segment sits in the middle of the shared vertical span, so the
    // line touches both boxes rather than floating beside them.
    expect(segments[0].y).toBe(25);
  });

  it('is symmetric — pinning the other box reads the same distance', () => {
    const a = rect(0, 0, 100, 50);
    const b = rect(140, 0, 100, 50);
    expect(segmentsBetween(b, a)[0].px).toBe(segmentsBetween(a, b)[0].px);
  });

  it('measures the vertical gap between stacked boxes', () => {
    const segments = segmentsBetween(rect(0, 0, 100, 50), rect(0, 114, 100, 50));
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ axis: 'v', y: 50, px: 64 });
  });

  it('measures both axes for diagonal neighbours', () => {
    const segments = segmentsBetween(rect(0, 0, 100, 50), rect(150, 100, 100, 50));
    expect(segments.map((s) => s.axis).sort()).toEqual(['h', 'v']);
    expect(segments.find((s) => s.axis === 'h').px).toBe(50);
    expect(segments.find((s) => s.axis === 'v').px).toBe(50);
  });

  it('measures the four insets of a nested box', () => {
    // The padding question: "is this 64 on both sides".
    const segments = segmentsBetween(rect(0, 0, 300, 200), rect(64, 40, 100, 100));
    expect(segments).toHaveLength(4);
    const byAxis = { h: [], v: [] };
    for (const s of segments) byAxis[s.axis].push(s.px);
    expect(byAxis.v.sort((a, b) => a - b)).toEqual([40, 60]); // top, bottom
    expect(byAxis.h.sort((a, b) => a - b)).toEqual([64, 136]); // left, right
  });

  it('nested measures work whichever box is pinned', () => {
    const outer = rect(0, 0, 300, 200);
    const inner = rect(64, 40, 100, 100);
    const a = segmentsBetween(outer, inner).map((s) => s.px).sort((x, y) => x - y);
    const b = segmentsBetween(inner, outer).map((s) => s.px).sort((x, y) => x - y);
    expect(a).toEqual(b);
  });

  it('shows a zero inset rather than hiding it', () => {
    // Flush alignment is exactly the fact being checked.
    const segments = segmentsBetween(rect(0, 0, 200, 100), rect(0, 20, 100, 60));
    expect(segments.some((s) => s.px === 0)).toBe(true);
  });

  it('refuses to measure interleaved boxes', () => {
    // Any number for a partial overlap is a guess wearing a badge.
    expect(segmentsBetween(rect(0, 0, 100, 100), rect(50, 50, 100, 100))).toEqual([]);
  });

  it('never emits a negative length', () => {
    const cases = [
      [rect(0, 0, 10, 10), rect(300, 0, 10, 10)],
      [rect(300, 0, 10, 10), rect(0, 0, 10, 10)],
      [rect(0, 0, 400, 400), rect(10, 10, 20, 20)],
      [rect(5, 5, 2, 2), rect(5, 300, 2, 2)],
    ];
    for (const [a, b] of cases) {
      for (const s of segmentsBetween(a, b)) {
        expect(s.length, JSON.stringify(s)).toBeGreaterThanOrEqual(0);
        expect(s.px).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('the measure layer', () => {
  function fixed(el, rectValue) {
    el.getBoundingClientRect = () => ({
      ...rectValue,
      width: rectValue.right - rectValue.left,
      height: rectValue.bottom - rectValue.top,
    });
    return el;
  }

  it('draws a badge carrying the pixel distance', () => {
    const guides = createGuideLayer();
    document.body.appendChild(guides.element);

    const a = fixed(document.createElement('div'), rect(0, 0, 100, 50));
    const b = fixed(document.createElement('div'), rect(140, 0, 100, 50));

    guides.measure(a, b);

    const badges = [...guides.element.querySelectorAll('.__iet-measure-badge')].filter(
      (n) => !n.parentElement.hidden
    );
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe('40');
  });

  it('clears the badges when the measurement ends', () => {
    const guides = createGuideLayer();
    document.body.appendChild(guides.element);

    const a = fixed(document.createElement('div'), rect(0, 0, 100, 50));
    const b = fixed(document.createElement('div'), rect(140, 0, 100, 50));

    guides.measure(a, b);
    guides.clearMeasure();

    const visible = [...guides.element.querySelectorAll('.__iet-measure')].filter((n) => !n.hidden);
    expect(visible).toHaveLength(0);
  });

  it('will not measure an element against itself', () => {
    const guides = createGuideLayer();
    document.body.appendChild(guides.element);

    const a = fixed(document.createElement('div'), rect(0, 0, 100, 50));
    guides.measure(a, a);

    expect([...guides.element.querySelectorAll('.__iet-measure')].every((n) => n.hidden)).toBe(true);
  });

  it('shows the element size on the guides', () => {
    const guides = createGuideLayer();
    document.body.appendChild(guides.element);

    const el = fixed(document.createElement('div'), rect(10, 10, 320, 240));
    guides.show(el);

    const size = guides.element.querySelector('.__iet-guide-size');
    expect(size.hidden).toBe(false);
    expect(size.textContent).toBe('320 × 240');
  });

  it('drops the measurement when guides are disabled', () => {
    const guides = createGuideLayer();
    document.body.appendChild(guides.element);

    const a = fixed(document.createElement('div'), rect(0, 0, 100, 50));
    const b = fixed(document.createElement('div'), rect(140, 0, 100, 50));

    guides.measure(a, b);
    guides.setEnabled(false);
    guides.setEnabled(true);
    guides.reposition(a);

    // Re-enabling must not resurrect a measurement from before the toggle.
    expect([...guides.element.querySelectorAll('.__iet-measure')].every((n) => n.hidden)).toBe(true);
  });
});

// ============================================================
//  Near misses
//
//  `segmentsBetween` answers the question people ask out loud —
//  "how far apart are these". This answers the one they do not
//  think to ask: two edges three pixels from matching were meant
//  to match, and nothing on screen reveals it.
// ============================================================
describe('nearMisses', () => {
  const rect = ({ top = 0, left = 0, width = 100, height = 50 }) => ({
    top, left, width, height, right: left + width, bottom: top + height,
  });

  it('reports an edge that is nearly aligned', () => {
    const a = rect({ left: 100 });
    const b = rect({ left: 103, top: 200 });

    expect(nearMisses(a, b)).toEqual([
      { edge: 'left', delta: 3 },
      { edge: 'right', delta: 3 },
    ]);
  });

  it('says nothing about edges that already line up', () => {
    // There is no finding in an alignment that is correct.
    const a = rect({ left: 100, top: 0 });
    const b = rect({ left: 100, top: 200 });

    expect(nearMisses(a, b).map((m) => m.edge)).not.toContain('left');
  });

  it('ignores differences past the tolerance', () => {
    // A 40px offset is a layout decision. Flagging it would bury the 3px
    // mistakes under things that are working as intended.
    const a = rect({ left: 100 });
    const b = rect({ left: 140, top: 200 });

    expect(nearMisses(a, b)).toEqual([]);
  });

  it('keeps the sign, so the direction of the error is readable', () => {
    const a = rect({ left: 100 });
    const b = rect({ left: 98, top: 200 });

    expect(nearMisses(a, b)[0]).toMatchObject({ edge: 'left', delta: -2 });
  });

  it('puts the worst offender first', () => {
    const a = rect({ left: 100, width: 100 });
    const b = rect({ left: 101, width: 103, top: 200 });

    // left is off by 1, right by 4 — the bigger error leads.
    expect(nearMisses(a, b)[0].edge).toBe('right');
  });

  it('honours a caller-supplied tolerance', () => {
    const a = rect({ left: 100 });
    const b = rect({ left: 108, top: 200 });

    expect(nearMisses(a, b)).toEqual([]);
    expect(nearMisses(a, b, 10).map((m) => m.edge)).toContain('left');
  });

  it('rounds to a tenth rather than reporting float noise', () => {
    // A subpixel layout reads as 2.9999999999; nobody wants that on a badge.
    const a = rect({ left: 100 });
    const b = rect({ left: 102.9999999, top: 200 });

    expect(nearMisses(a, b)[0].delta).toBe(3);
  });
});

describe('measuring with the guides toggle off', () => {
  it('still measures, because the toggle governs the dashed lines', () => {
    // The Measure tool asking for a distance is an explicit request. Gating
    // it on an unrelated view option would make the tool silently dead for
    // anybody who had turned guides off — the exact failure that makes a
    // feature look broken rather than switched off.
    const guides = createGuideLayer();
    document.body.innerHTML = '';
    document.body.append(guides.element);

    const mk = (box) => {
      const el = document.createElement('div');
      el.getBoundingClientRect = () => box;
      document.body.appendChild(el);
      return el;
    };
    const a = mk({ top: 0, bottom: 50, left: 0, right: 100, width: 100, height: 50 });
    const b = mk({ top: 200, bottom: 250, left: 0, right: 100, width: 100, height: 50 });

    guides.setEnabled(false);
    guides.measure(a, b);

    expect(guides.element.hidden).toBe(false);
  });

  it('hides the alignment lines it is not being asked for', () => {
    // Revealing the layer for the badges would otherwise reveal four dashed
    // lines sitting at whatever transform they last had.
    const guides = createGuideLayer();
    document.body.innerHTML = '';
    document.body.append(guides.element);

    const mk = (box) => {
      const el = document.createElement('div');
      el.getBoundingClientRect = () => box;
      document.body.appendChild(el);
      return el;
    };
    const a = mk({ top: 0, bottom: 50, left: 0, right: 100, width: 100, height: 50 });
    const b = mk({ top: 200, bottom: 250, left: 0, right: 100, width: 100, height: 50 });

    guides.setEnabled(false);
    guides.measure(a, b);

    const lines = guides.element.querySelectorAll('.__iet-guide-h, .__iet-guide-v');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.hidden).toBe(true);
  });
});

describe('re-enabling after a measurement', () => {
  const mk = (box) => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => box;
    document.body.appendChild(el);
    return el;
  };

  it('brings the alignment lines back', () => {
    // Measuring with guides off hides the four lines so the badges can be
    // shown alone. Nothing else put them back until the next hover, so a
    // toggle off-and-on left the guides switched on and invisible.
    const guides = createGuideLayer();
    document.body.innerHTML = '';
    document.body.append(guides.element);

    const a = mk({ top: 0, bottom: 50, left: 0, right: 100, width: 100, height: 50 });
    const b = mk({ top: 200, bottom: 250, left: 0, right: 100, width: 100, height: 50 });

    guides.setEnabled(false);
    guides.measure(a, b);
    guides.setEnabled(true);

    const lines = guides.element.querySelectorAll('.__iet-guide-h, .__iet-guide-v');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.hidden).toBe(false);
  });
});
