"use strict";

// ============================================================
//  Alignment guides and measurements
//
//  Two questions an outline cannot answer:
//
//  1. "Is this aligned with anything else?" — four dashed lines
//     extending from the element's edges across the viewport.
//  2. "How far is it from that?" — pixel distances, drawn as
//     measure segments with a badge, between a pinned element
//     and whatever is hovered. Pin one thing with Inspect, move
//     the pointer, read the gap. Nested elements measure their
//     four insets instead, which is how "is this padding 64px
//     on both sides" gets answered without opening devtools.
//
//  Every node is created once and repositioned — creating and
//  destroying on mousemove would churn the DOM under the very
//  layout being measured.
// ============================================================

const P = "__iet";

/** More segments than this means the reading is noise, not measurement. */
const MAX_SEGMENTS = 4;

/**
 * The measure segments between two rectangles.
 *
 * Pure geometry, exported for tests: every branch below is a picture, and a
 * wrong picture looks plausible right up until somebody trusts the number.
 *
 * Three arrangements, in the order they are checked:
 *
 * - **Nested** (one contains the other): the four insets, top/right/bottom/
 *   left, from the inner box to the outer. The padding question.
 * - **Disjoint on an axis**: one segment across the gap on that axis. The
 *   segment sits at the midpoint of the *shared* span on the other axis, so
 *   the line touches both boxes rather than floating beside them.
 * - **Overlapping without containment**: nothing. Any number shown for two
 *   interleaved boxes is a guess wearing a badge.
 *
 * @param {{top:number,right:number,bottom:number,left:number}} a  pinned
 * @param {{top:number,right:number,bottom:number,left:number}} b  hovered
 * @returns {Array<{axis:'h'|'v', x:number, y:number, length:number, px:number}>}
 *          `x,y` is the segment's start; length is always positive and runs
 *          right (h) or down (v); `px` is the rounded reading on the badge
 */
export function segmentsBetween(a, b) {
  const contains = (outer, inner) =>
    outer.left <= inner.left &&
    outer.right >= inner.right &&
    outer.top <= inner.top &&
    outer.bottom >= inner.bottom;

  // Nested: four insets. Zero-length insets are still shown — "0" against
  // one edge is exactly the flush-alignment fact being checked.
  const nested = contains(a, b) ? { outer: a, inner: b } : contains(b, a) ? { outer: b, inner: a } : null;
  if (nested) {
    const { outer, inner } = nested;
    const midX = inner.left + (inner.right - inner.left) / 2;
    const midY = inner.top + (inner.bottom - inner.top) / 2;
    return [
      { axis: "v", x: midX, y: outer.top, length: inner.top - outer.top, px: Math.round(inner.top - outer.top) },
      { axis: "v", x: midX, y: inner.bottom, length: outer.bottom - inner.bottom, px: Math.round(outer.bottom - inner.bottom) },
      { axis: "h", x: outer.left, y: midY, length: inner.left - outer.left, px: Math.round(inner.left - outer.left) },
      { axis: "h", x: inner.right, y: midY, length: outer.right - inner.right, px: Math.round(outer.right - inner.right) },
    ];
  }

  const segments = [];

  // The span both boxes share on an axis, or the nearer box's own span when
  // they share none — the segment has to sit somewhere honest either way.
  const sharedMid = (a1, a2, b1, b2) => {
    const lo = Math.max(a1, b1);
    const hi = Math.min(a2, b2);
    if (lo <= hi) return lo + (hi - lo) / 2;
    return a1 + (a2 - a1) / 2;
  };

  // Horizontal gap.
  if (b.left >= a.right) {
    segments.push({ axis: "h", x: a.right, y: sharedMid(a.top, a.bottom, b.top, b.bottom), length: b.left - a.right, px: Math.round(b.left - a.right) });
  } else if (a.left >= b.right) {
    segments.push({ axis: "h", x: b.right, y: sharedMid(a.top, a.bottom, b.top, b.bottom), length: a.left - b.right, px: Math.round(a.left - b.right) });
  }

  // Vertical gap.
  if (b.top >= a.bottom) {
    segments.push({ axis: "v", x: sharedMid(a.left, a.right, b.left, b.right), y: a.bottom, length: b.top - a.bottom, px: Math.round(b.top - a.bottom) });
  } else if (a.top >= b.bottom) {
    segments.push({ axis: "v", x: sharedMid(a.left, a.right, b.left, b.right), y: b.bottom, length: a.top - b.bottom, px: Math.round(a.top - b.bottom) });
  }

  return segments;
}

/**
 * Edges that *almost* line up.
 *
 * `segmentsBetween` answers "how far apart are these", which is the question
 * people ask out loud. This answers the one they do not think to ask: two
 * edges three pixels from matching were almost certainly meant to match, and
 * nothing on screen reveals it. A real gap is a decision; a near miss is a
 * mistake, and it survives review precisely because it is too small to see.
 *
 * Exact matches are excluded — there is nothing to report about an edge that
 * is already aligned. Anything past the tolerance is excluded too: at that
 * distance the edges were plainly not meant to meet.
 *
 * @param {number} tolerance px, beyond which a difference is a layout choice
 * @returns {Array<{edge:string, delta:number}>} largest first
 */
export function nearMisses(a, b, tolerance = 4) {
  const deltas = {
    left: b.left - a.left,
    right: b.right - a.right,
    top: b.top - a.top,
    bottom: b.bottom - a.bottom,
  };

  return Object.entries(deltas)
    .filter(([, d]) => d !== 0 && Math.abs(d) <= tolerance)
    .map(([edge, delta]) => ({ edge, delta: Math.round(delta * 10) / 10 }))
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

function line(orientation) {
  const el = document.createElement("div");
  el.className = `${P}-guide ${P}-guide-${orientation}`;
  return el;
}

function measureNode() {
  const seg = document.createElement("div");
  seg.className = `${P}-measure`;
  const badge = document.createElement("span");
  badge.className = `${P}-measure-badge`;
  seg.appendChild(badge);
  seg.hidden = true;
  return seg;
}

export function createGuideLayer() {
  const layer = document.createElement("div");
  layer.className = `${P}-guides`;
  layer.hidden = true;

  const top = line("h");
  const bottom = line("h");
  const left = line("v");
  const right = line("v");

  // The element's own size, riding its bottom edge. VisBug shows it and it
  // is right to: "how wide is this actually" is the most-asked measurement
  // of all, and it costs one badge.
  const size = document.createElement("span");
  size.className = `${P}-guide-size`;
  size.hidden = true;

  const measures = Array.from({ length: MAX_SEGMENTS }, measureNode);

  // One badge, not four. A single "left off by 3px" is a finding somebody
  // acts on; all four edges at once is a wall of numbers nobody reads.
  const nearMiss = document.createElement("div");
  nearMiss.className = `${P}-nearmiss`;
  nearMiss.hidden = true;

  layer.append(top, bottom, left, right, size, nearMiss, ...measures);

  /**
   * The four alignment lines, hideable as a group.
   *
   * Needed because a measurement can be asked for while the guides toggle is
   * off. Revealing the layer for the badges would otherwise reveal these too,
   * sitting at whatever transform they last had — or at the viewport corner,
   * having never been placed.
   */
  const lines = [top, bottom, left, right];
  const setLinesVisible = (visible) => {
    for (const el of lines) el.hidden = !visible;
  };

  let enabled = true;
  /** The pinned/hovered pair, kept so scrolling can re-derive positions. */
  let measured = null;

  function place(el) {
    const rect = el.getBoundingClientRect();
    top.style.transform = `translateY(${rect.top}px)`;
    bottom.style.transform = `translateY(${rect.bottom}px)`;
    left.style.transform = `translateX(${rect.left}px)`;
    right.style.transform = `translateX(${rect.right}px)`;

    size.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    size.hidden = false;
    // Below the bottom edge, centred; measured after content is set.
    const w = size.offsetWidth || 60;
    size.style.transform = `translate(${rect.left + rect.width / 2 - w / 2}px, ${Math.min(rect.bottom + 6, window.innerHeight - 24)}px)`;
  }

  function drawMeasures() {
    const segments = measured
      ? segmentsBetween(measured.a.getBoundingClientRect(), measured.b.getBoundingClientRect())
      : [];

    measures.forEach((node, i) => {
      const seg = segments[i];
      if (!seg) {
        node.hidden = true;
        return;
      }
      node.dataset.axis = seg.axis;
      node.style.transform = `translate(${seg.x}px, ${seg.y}px)`;
      if (seg.axis === "h") {
        node.style.width = `${seg.length}px`;
        node.style.height = "0px";
      } else {
        node.style.width = "0px";
        node.style.height = `${seg.length}px`;
      }
      node.firstChild.textContent = `${seg.px}`;
      node.hidden = false;
    });

    drawNearMiss();
  }

  function drawNearMiss() {
    const pair = measured;
    if (!pair) {
      nearMiss.hidden = true;
      return;
    }

    const b = pair.b.getBoundingClientRect();
    const [worst] = nearMisses(pair.a.getBoundingClientRect(), b);
    if (!worst) {
      nearMiss.hidden = true;
      return;
    }

    const sign = worst.delta > 0 ? "" : "-";
    nearMiss.textContent = `${worst.edge} off by ${sign}${Math.abs(worst.delta)}px`;
    nearMiss.style.transform = `translate(${b.left}px, ${Math.min(b.bottom + 6, window.innerHeight - 24)}px)`;
    nearMiss.hidden = false;
  }

  return {
    element: layer,

    /** @param {'hover'|'selected'|'edited'} state */
    show(el, state = "hover") {
      if (!enabled || !el) return;
      layer.dataset.state = state;
      setLinesVisible(true);
      place(el);
      layer.hidden = false;
    },

    hide() {
      layer.hidden = true;
      measured = null;
      nearMiss.hidden = true;
      for (const node of measures) node.hidden = true;
    },

    /**
     * Distances between a pinned element and a hovered one.
     *
     * Lives alongside the guides rather than replacing them: the lines say
     * "these edges", the badges say "this far apart".
     */
    measure(a, b) {
      if (!a || !b || a === b) {
        measured = null;
        for (const node of measures) node.hidden = true;
        nearMiss.hidden = true;
        return;
      }

      // Deliberately not gated on `enabled`. That toggle is labelled
      // "Alignment guides — dashed lines on hover", and it governs those
      // lines. A measurement is always something that was explicitly asked
      // for, so the Measure tool cannot be silently dead because a view
      // option unrelated to it happens to be switched off.
      if (!enabled) {
        setLinesVisible(false);
        size.hidden = true;
      }

      measured = { a, b };
      drawMeasures();
      layer.hidden = false;
    },

    clearMeasure() {
      measured = null;
      for (const node of measures) node.hidden = true;
      nearMiss.hidden = true;
      // With guides off the layer exists only for the measurement, so it
      // goes away with it rather than lingering as an empty pane.
      if (!enabled) layer.hidden = true;
    },

    reposition(el) {
      if (layer.hidden) return;
      if (el) place(el);
      // Scrolling moves both boxes; re-derive rather than drift.
      if (measured) drawMeasures();
    },

    /** Turning guides off hides them immediately. */
    setEnabled(value) {
      enabled = Boolean(value);

      // Measuring with guides off hides the four lines, and nothing else
      // would put them back until the next hover. Restoring here means the
      // toggle is the whole story rather than most of it.
      if (enabled) {
        setLinesVisible(true);
        return;
      }

      if (!enabled) {
        layer.hidden = true;
        measured = null;
        nearMiss.hidden = true;
        // The nodes too, not just the layer: `show()` unhides the layer,
        // and a badge left visible inside it would resurrect a measurement
        // from before the toggle.
        for (const node of measures) node.hidden = true;
      }
    },

    get enabled() {
      return enabled;
    },
  };
}
