"use strict";

// ============================================================
//  Search
//
//  Find elements the pointer cannot: the third "Sign up" on the
//  page, everything matching `.btn-primary`, the copy you know
//  is there but cannot see. A query is tried as a CSS selector
//  first and as text when it is not one — and each match shows
//  the source file it came from, which is the part a generic
//  design tool has no way to know.
//
//  Enter walks the matches; choosing one hands it to whatever
//  tool is active, exactly as if it had been clicked.
// ============================================================

import { annotationFor } from "../element-selector.js";

const P = "__iet";
const MAX_RESULTS = 50;

/**
 * Every element matching a query.
 *
 * Selector first: `.btn`, `img`, `[data-x]`. Anything that does not parse
 * as a selector is a text search, case-insensitive, matching elements with
 * that text in a *direct* child node — matching descendants too would
 * return `<body>` for every query on the page.
 *
 * @param {string} query
 * @param {Document} doc
 * @param {(el: Element) => boolean} isExcluded  our own UI
 */
export function findMatches(query, doc = document, isExcluded = () => false) {
  const q = query.trim();
  if (!q) return [];

  // Selector first — but "no results" falls through to text, not just "no
  // parse". Almost any phrase parses as a selector: "sign up" is the type
  // selector `Sign` with a descendant `up`, perfectly valid and perfectly
  // empty, and treating parse-success as the branch point made the text
  // search unreachable for exactly the queries people actually type.
  let matched = [];
  try {
    matched = [...doc.querySelectorAll(q)];
  } catch {
    // Not a selector at all.
  }

  if (matched.length === 0) {
    const needle = q.toLowerCase();
    matched = [...doc.querySelectorAll("body *")].filter((el) => {
      for (const node of el.childNodes) {
        if (node.nodeType === 3 && node.textContent.toLowerCase().includes(needle)) return true;
      }
      return false;
    });
  }

  return matched
    .filter((el) => el instanceof Element && !isExcluded(el) && el.tagName !== "SCRIPT")
    .slice(0, MAX_RESULTS);
}

/**
 * @param {object} opts
 * @param {(el: Element) => void} opts.onPick   activate the current tool on it
 * @param {(el: Element|null) => void} opts.onHighlight  preview while cycling
 * @param {(el: Element) => boolean} [opts.isExcluded]
 */
export function createSearchPanel({ onPick, onHighlight, isExcluded = () => false }) {
  const panel = document.createElement("div");
  panel.id = `${P}-search`;
  panel.hidden = true;

  const input = document.createElement("input");
  input.className = `${P}-search-input`;
  input.type = "text";
  input.placeholder = "text, or a selector like .btn";
  input.setAttribute("aria-label", "Search the page");

  const count = document.createElement("span");
  count.className = `${P}-search-count`;

  const hint = document.createElement("span");
  hint.className = `${P}-search-hint`;
  hint.textContent = "enter: next · ⇧enter: back · ⌘enter: use it";

  const source = document.createElement("span");
  source.className = `${P}-search-source`;

  panel.append(input, count, source, hint);

  let matches = [];
  let index = -1;

  function refresh() {
    matches = findMatches(input.value, document, isExcluded);
    index = -1;
    count.textContent = input.value.trim() ? `${matches.length}` : "";
    source.textContent = "";
    onHighlight(null);
  }

  function step(direction) {
    if (!matches.length) return;
    index = (index + direction + matches.length) % matches.length;

    const el = matches[index];
    if (!el.isConnected) {
      refresh();
      return;
    }

    el.scrollIntoView({ block: "center", behavior: "smooth" });
    count.textContent = `${index + 1} of ${matches.length}`;

    const where = annotationFor(el);
    source.textContent = where.sourceFile
      ? `${where.sourceFile.split("/").pop()}${where.sourceLine ? `:${where.sourceLine}` : ""}`
      : "no source map";
    source.dataset.unmapped = where.sourceFile ? "false" : "true";

    onHighlight(el);
  }

  input.addEventListener("input", refresh);
  input.addEventListener("keydown", (e) => {
    // The page's shortcuts must not fire while typing a query, and nor may
    // our own single-key tool switching.
    e.stopPropagation();

    if (e.key === "Escape") {
      e.preventDefault();
      api.close();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // Enter always walks; ⌘/ctrl-Enter takes the current match. An
      // earlier version picked on plain Enter once something was
      // highlighted — which made the second match unreachable by keyboard,
      // since the first Enter to pass it took it instead.
      if ((e.metaKey || e.ctrlKey) && index >= 0 && matches[index]?.isConnected) {
        const el = matches[index];
        api.close();
        onPick(el);
        return;
      }
      step(e.shiftKey ? -1 : 1);
    }
  });

  const api = {
    element: panel,

    open() {
      panel.hidden = false;
      input.focus();
      input.select();
      if (input.value) refresh();
    },

    close() {
      panel.hidden = true;
      matches = [];
      index = -1;
      onHighlight(null);
    },

    toggle() {
      if (panel.hidden) api.open();
      else api.close();
    },

    get visible() {
      return !panel.hidden;
    },

    /** Mirrors the rail, like every panel that anchors to it. */
    setSide(side) {
      panel.dataset.side = side === "right" ? "right" : "left";
    },
  };

  return api;
}
