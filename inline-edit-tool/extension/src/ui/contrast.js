"use strict";

// ============================================================
//  WCAG contrast
//
//  The mathematics behind the Accessibility tool's verdicts.
//  Pure, because a pass/fail badge is a claim about compliance:
//  a wrong ratio wearing a green AA chip is worse than no tool,
//  and every constant below is straight out of WCAG 2.x —
//  not a plausible-looking approximation of it.
// ============================================================

/**
 * Parse what getComputedStyle returns: `rgb(r, g, b)` or
 * `rgba(r, g, b, a)`. Browsers normalise every author format —
 * hex, hsl, named — into these two, so nothing else needs parsing.
 *
 * @returns {{r:number,g:number,b:number,a:number}|null}
 */
export function parseCssColor(value) {
  const match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
    String(value ?? "").trim()
  );
  if (!match) return null;

  const [, r, g, b, a] = match;
  return {
    r: Math.min(255, Number(r)),
    g: Math.min(255, Number(g)),
    b: Math.min(255, Number(b)),
    a: a === undefined ? 1 : Math.max(0, Math.min(1, Number(a))),
  };
}

/**
 * Composite a translucent colour over a backdrop.
 *
 * Text at rgba(0,0,0,0.6) on white is *not* black for contrast
 * purposes — it is grey, and treating the alpha as opaque
 * reports ratios the eye never sees.
 */
export function compositeOver(fg, backdrop) {
  const a = fg.a ?? 1;
  return {
    r: fg.r * a + backdrop.r * (1 - a),
    g: fg.g * a + backdrop.g * (1 - a),
    b: fg.b * a + backdrop.b * (1 - a),
    a: 1,
  };
}

/** WCAG relative luminance, from the sRGB transfer function. */
export function luminance({ r, g, b }) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * The contrast ratio between two opaque colours, 1–21.
 *
 * Symmetric on purpose — which one is "text" does not change
 * the number, and the formula orders by luminance itself.
 */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Is this "large text" in WCAG's sense?
 *
 * 18pt (24px), or 14pt (18.66px) when bold. The px conversions
 * are WCAG's own; rounding 18.66 up to 19 would misclassify
 * text at exactly the boundary.
 */
export function isLargeText(fontSizePx, fontWeight) {
  const weight = Number(fontWeight) || 400;
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && weight >= 700);
}

/**
 * The verdict for a ratio.
 *
 * @returns {{ratio:number, aa:boolean, aaa:boolean, large:boolean}}
 *          `ratio` rounded to 2dp for display; the checks use the
 *          unrounded value, so 4.4949 does not round its way to a pass
 */
export function wcagVerdict(ratio, { fontSizePx = 16, fontWeight = 400 } = {}) {
  const large = isLargeText(fontSizePx, fontWeight);
  return {
    ratio: Math.round(ratio * 100) / 100,
    large,
    aa: ratio >= (large ? 3 : 4.5),
    aaa: ratio >= (large ? 4.5 : 7),
  };
}

/**
 * The colours an element is actually rendered with.
 *
 * The background is almost never on the element itself — it is
 * somewhere up the tree, and every layer of rgba between here
 * and there tints it. Walk up compositing as we go; page
 * default is white, matching what the browser paints when
 * nobody set anything.
 *
 * Lives here rather than in the card so the walk is testable,
 * but it reads the DOM — the pure functions above are the part
 * with exhaustive tests.
 *
 * @param {Element} el
 * @param {Window} win
 * @returns {{fg: object, bg: object, fontSizePx: number, fontWeight: number}|null}
 */
export function effectiveColors(el, win = window) {
  const style = win.getComputedStyle(el);
  const fg = parseCssColor(style.color);
  if (!fg) return null;

  // Stack translucent backgrounds from the element upward, then flatten
  // onto white from the bottom of the stack.
  const layers = [];
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    const bg = parseCssColor(win.getComputedStyle(node).backgroundColor);
    if (!bg || bg.a === 0) continue;
    layers.push(bg);
    if (bg.a === 1) break;
  }

  let bg = { r: 255, g: 255, b: 255, a: 1 };
  for (const layer of layers.reverse()) bg = compositeOver(layer, bg);

  return {
    fg: compositeOver(fg, bg),
    bg,
    fontSizePx: parseFloat(style.fontSize) || 16,
    fontWeight: Number(style.fontWeight) || 400,
  };
}
