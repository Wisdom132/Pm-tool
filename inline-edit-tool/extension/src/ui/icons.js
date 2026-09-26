"use strict";

// ============================================================
//  Icons
//
//  Hand-built 24x24 stroke icons. Drawn with createElementNS
//  rather than innerHTML so nothing in the UI ever parses a
//  string as markup.
// ============================================================

const NS = "http://www.w3.org/2000/svg";

/** [element, attributes] pairs, on a 24x24 grid. */
const SHAPES = {
  // Crosshair — inspect an element without changing it.
  inspect: [
    ["circle", { cx: 12, cy: 12, r: 7 }],
    ["path", { d: "M12 1v3M12 20v3M1 12h3M20 12h3" }],
    ["circle", { cx: 12, cy: 12, r: 1.6, fill: "currentColor", stroke: "none" }],
  ],

  // Pencil — edit text.
  edit: [
    ["path", { d: "M4 20h4L19.5 8.5a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20z" }],
    ["path", { d: "M14.5 6.5l3.5 3.5" }],
  ],

  undo: [
    ["path", { d: "M4 8h9a6 6 0 0 1 0 12H8" }],
    ["path", { d: "M8 4L4 8l4 4" }],
  ],

  redo: [
    ["path", { d: "M20 8h-9a6 6 0 0 0 0 12h5" }],
    ["path", { d: "M16 4l4 4-4 4" }],
  ],

  // Stacked lines — the list of pending changes.
  changes: [
    ["path", { d: "M9 6h11M9 12h11M9 18h11" }],
    ["path", { d: "M4.5 6h.01M4.5 12h.01M4.5 18h.01" }],
  ],

  // Git pull request.
  submit: [
    ["circle", { cx: 6, cy: 6, r: 2.5 }],
    ["circle", { cx: 6, cy: 18, r: 2.5 }],
    ["circle", { cx: 18, cy: 18, r: 2.5 }],
    ["path", { d: "M6 8.5v7" }],
    ["path", { d: "M13 6h2.5A2.5 2.5 0 0 1 18 8.5v7" }],
    ["path", { d: "M10.5 3.5L13 6l-2.5 2.5" }],
  ],

  // Crossing rules — alignment guides.
  guides: [
    ["path", { d: "M3 9h18M3 15h18M9 3v18M15 3v18", "stroke-dasharray": "2 2.5" }],
  ],

  close: [["path", { d: "M18 6L6 18M6 6l12 12" }]],
};

/**
 * @param {keyof SHAPES} name
 * @param {number} size
 * @returns {SVGElement}
 */
export function icon(name, size = 20) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  for (const [tag, attrs] of SHAPES[name] || []) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(key, String(value));
    }
    svg.appendChild(node);
  }

  return svg;
}

export const ICON_NAMES = Object.keys(SHAPES);
