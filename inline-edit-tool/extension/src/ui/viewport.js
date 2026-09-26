"use strict";

// ============================================================
//  Responsive preview
//
//  Resizes the browser window rather than scaling the page.
//
//  Constraining the page's width would be easier and would look
//  the part, but CSS media queries answer to the viewport, not
//  to an element — so a "mobile" preview built that way would
//  still render desktop breakpoints. Only a real viewport change
//  tests what the editor thinks they are testing.
// ============================================================

export const BREAKPOINTS = [
  { id: "mobile", label: "Mobile", width: 390, height: 844, hint: "iPhone-ish" },
  { id: "tablet", label: "Tablet", width: 834, height: 1112, hint: "iPad-ish" },
  { id: "laptop", label: "Laptop", width: 1280, height: 800 },
  { id: "desktop", label: "Desktop", width: 1680, height: 1050 },
];

/** The breakpoint whose width matches the current viewport, if any. */
export function activeBreakpoint(width, list = BREAKPOINTS) {
  return list.find((b) => Math.abs(b.width - width) <= 2) || null;
}

/**
 * Chrome window width includes frame furniture, so asking for a 390px window
 * yields a narrower viewport. Correcting by the observed difference gets the
 * viewport itself to the requested size.
 */
export function windowSizeFor(breakpoint, { outerWidth, innerWidth, outerHeight, innerHeight }) {
  return {
    width: breakpoint.width + Math.max(0, outerWidth - innerWidth),
    height: breakpoint.height + Math.max(0, outerHeight - innerHeight),
  };
}
