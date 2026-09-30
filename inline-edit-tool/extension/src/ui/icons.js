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
    [
      "circle",
      { cx: 12, cy: 12, r: 1.6, fill: "currentColor", stroke: "none" },
    ],
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

  // Sliders — element properties.
  properties: [
    ["path", { d: "M5 21v-7M5 10V3M12 21v-9M12 8V3M19 21v-5M19 12V3" }],
    ["path", { d: "M2.5 14h5M9.5 8h5M16.5 16h5" }],
  ],

  // Trash — delete an element.
  trash: [
    ["path", { d: "M4 7h16" }],
    ["path", { d: "M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" }],
    ["path", { d: "M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" }],
  ],

  // Overlapping squares — duplicate.
  copy: [
    ["rect", { x: 9, y: 9, width: 11, height: 11, rx: 2 }],
    ["path", { d: "M5 15V5a2 2 0 0 1 2-2h10" }],
  ],

  arrowUp: [["path", { d: "M12 19V5M6 11l6-6 6 6" }]],
  arrowDown: [["path", { d: "M12 5v14M18 13l-6 6-6-6" }]],

  // Device frame — responsive preview.
  responsive: [
    ["rect", { x: 2, y: 5, width: 13, height: 11, rx: 1.5 }],
    ["rect", { x: 17, y: 9, width: 5, height: 10, rx: 1.5 }],
    ["path", { d: "M6 19h5" }],
  ],

  // Crossing rules — alignment guides.
  guides: [
    [
      "path",
      { d: "M3 9h18M3 15h18M9 3v18M15 3v18", "stroke-dasharray": "2 2.5" },
    ],
  ],

  // A speech bubble — leaving a comment rather than making a change.
  comment: [
    [
      "path",
      {
        d: "M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z",
      },
    ],
  ],

  close: [["path", { d: "M18 6L6 18M6 6l12 12" }]],
  a11y: [
    ["circle", { cx: "12", cy: "5", r: "2" }],
    ["path", { d: "M4 9h16M12 9v6M12 15l-4 5M12 15l4 5" }],
  ],
  search: [
    ["circle", { cx: "11", cy: "11", r: "7" }],
    ["path", { d: "M21 21l-4.5-4.5" }],
  ],
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
