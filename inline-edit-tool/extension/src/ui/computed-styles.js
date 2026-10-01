"use strict";

// ============================================================
//  What somebody actually set
//
//  `getComputedStyle` returns around 340 properties, almost all
//  of them the browser's default. Showing that list answers no
//  question anybody has. What a person wants to know standing
//  in front of an element is "what is different about *this*
//  one", which is a much shorter list — usually fewer than ten.
//
//  The technique is VisBug's: keep a map of the default each
//  property has when nobody has touched it, and show only the
//  deviations. The map is the whole trick, and it has to be
//  right — a wrong default either hides something real or
//  reports every element as having set it.
// ============================================================

/**
 * The value each property has when nothing set it.
 *
 * Only properties worth showing a designer. `font-family` is left out on
 * purpose: it is inherited from the page and effectively always "different",
 * so it would be noise on every element.
 */
export const DEFAULTS = {
  // Box
  padding: "0px",
  margin: "0px",
  "border-radius": "0px",
  "border-width": "0px",
  "box-shadow": "none",
  outline: "none",
  // Type
  "font-size": "16px",
  "font-weight": "400",
  "font-style": "normal",
  "line-height": "normal",
  "letter-spacing": "normal",
  "text-align": "start",
  "text-transform": "none",
  "text-decoration-line": "none",
  "white-space": "normal",
  // Paint
  "background-image": "none",
  opacity: "1",
  filter: "none",
  transform: "none",
  // Layout
  display: "block",
  position: "static",
  "flex-direction": "row",
  "flex-wrap": "nowrap",
  "align-items": "normal",
  "justify-content": "normal",
  gap: "normal",
  "grid-template-columns": "none",
  "grid-template-rows": "none",
  overflow: "visible",
  "z-index": "auto",
};

/**
 * Values that mean "nothing here", whatever the property.
 *
 * A browser can report `0px 0px 0px 0px` for an untouched padding, or
 * `rgba(0, 0, 0, 0)` for an unset background. Treating those as deviations
 * puts a row on every element and buries the real ones.
 */
const EMPTY = new Set([
  "",
  "none",
  "normal",
  "auto",
  "0px",
  "0px 0px 0px 0px",
  "rgba(0, 0, 0, 0)",
  "0s",
  "visible",
  "static",
]);

/**
 * The properties this element actually differs on.
 *
 * @param {Element} el
 * @param {Window} win
 * @returns {Array<{prop: string, value: string}>} in DEFAULTS order, which
 *          groups box, type, paint and layout together rather than
 *          alphabetically — nobody reads styles alphabetically
 */
export function nonDefaultStyles(el, win = window) {
  const computed = win.getComputedStyle(el);
  const out = [];

  for (const [prop, fallback] of Object.entries(DEFAULTS)) {
    const value = computed.getPropertyValue(prop);
    if (!value) continue;

    const normalised = value.trim();
    if (normalised === fallback) continue;
    if (EMPTY.has(normalised)) continue;

    // `display: block` on a <div> is not news. The default map holds the
    // *initial* value, but an element's own kind can make a different value
    // equally uninteresting.
    if (prop === "display" && normalised === defaultDisplay(el)) continue;

    out.push({ prop, value: normalised });
  }

  return out;
}

/**
 * What `display` would be for this tag with no CSS at all.
 *
 * A short table rather than a probe element: inserting one into the page to
 * measure it would be a mutation on somebody else's document, for a
 * cosmetic answer.
 */
function defaultDisplay(el) {
  const tag = el.tagName;

  if (/^(SPAN|A|B|I|EM|STRONG|SMALL|CODE|LABEL|BR)$/.test(tag)) return "inline";
  if (/^(IMG|INPUT|BUTTON|SELECT|TEXTAREA|VIDEO|SVG)$/.test(tag)) return "inline-block";
  if (tag === "LI") return "list-item";
  if (tag === "TABLE") return "table";
  if (tag === "TR") return "table-row";
  if (/^(TD|TH)$/.test(tag)) return "table-cell";

  return "block";
}
