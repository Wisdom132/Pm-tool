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

// ============================================================
//  APCA
//
//  WCAG 2's ratio is a simple quotient of two luminances, and
//  it is known to be wrong in the middle of the range — it
//  passes some grey-on-grey pairs that are genuinely hard to
//  read and fails some dark-on-dark pairs that are fine. APCA
//  (the model behind WCAG 3) models perceived contrast instead,
//  and is polarity-aware: dark-on-light and light-on-dark at
//  the same ratio do not read the same.
//
//  Implemented directly rather than pulled from colorjs.io.
//  The whole algorithm is the thirty lines below, and this
//  runs in a content script injected into other people's
//  pages, where a library is weight on every page load.
//
//  Constants are from the W3 APCA 0.1.9 lookup. They are not
//  adjustable and not approximations — a tuned constant here
//  produces a number that looks authoritative and is wrong.
// ============================================================

const APCA = {
  // sRGB to luminance. A plain 2.4 power curve, not WCAG's piecewise one.
  exp: 2.4,
  r: 0.2126729,
  g: 0.7151522,
  b: 0.072175,

  // Near-black is soft-clamped: below this, luminance is raised, because
  // display black is never truly 0 and flare dominates down there.
  blackThreshold: 0.022,
  blackExp: 1.414,

  // Normal polarity: dark text on a light background.
  normalBg: 0.56,
  normalText: 0.57,
  // Reverse polarity: light text on a dark background.
  reverseBg: 0.65,
  reverseText: 0.62,

  scale: 1.14,
  // Below this the result is noise, and is reported as zero.
  deadzone: 0.1,
  offset: 0.027,
};

/** APCA screen luminance for one colour. */
function apcaLuminance({ r, g, b }) {
  const c = (v) => Math.pow(v / 255, APCA.exp);
  const y = APCA.r * c(r) + APCA.g * c(g) + APCA.b * c(b);

  // Soft clamp, not a hard floor: a hard floor creates a discontinuity
  // right where dark UI themes live.
  return y > APCA.blackThreshold ? y : y + Math.pow(APCA.blackThreshold - y, APCA.blackExp);
}

/**
 * APCA lightness contrast, roughly -108…+106.
 *
 * The sign carries meaning and must not be discarded: positive is dark text
 * on a light background, negative is light on dark. Two pairs with the same
 * magnitude and opposite sign are different readability situations.
 *
 * @param {object} text  foreground, already composited over its backdrop
 * @param {object} bg    background, opaque
 */
export function apcaContrast(text, bg) {
  const ytext = apcaLuminance(text);
  const ybg = apcaLuminance(bg);

  const normal = ybg > ytext;
  const raw = normal
    ? (Math.pow(ybg, APCA.normalBg) - Math.pow(ytext, APCA.normalText)) * APCA.scale
    : (Math.pow(ybg, APCA.reverseBg) - Math.pow(ytext, APCA.reverseText)) * APCA.scale;

  if (Math.abs(raw) < APCA.deadzone) return 0;

  const adjusted = raw > 0 ? raw - APCA.offset : raw + APCA.offset;
  return Math.round(adjusted * 100 * 10) / 10;
}

/**
 * What an APCA score means for real text, from the W3 draft's font table.
 *
 * Returned as guidance rather than pass/fail, because APCA's answer depends
 * on size and weight in a way a single threshold cannot carry. Saying "fine
 * for body text" is more use than "AA".
 */
export function apcaVerdict(lc, { fontSizePx = 16, fontWeight = 400 } = {}) {
  const score = Math.abs(lc);
  const weight = Number(fontWeight) || 400;
  const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && weight >= 700);

  if (score >= 75) return { score, level: "any text", ok: true };
  if (score >= 60) return { score, level: "body text", ok: true };
  if (score >= 45) return { score, level: large ? "large text" : "headlines only", ok: large };
  if (score >= 30) return { score, level: "large text only", ok: false };
  return { score, level: "not readable", ok: false };
}
