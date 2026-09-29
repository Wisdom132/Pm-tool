"use strict";

// ============================================================
//  A selector that re-finds an element later
//
//  Feedback is pinned to an element, and the element has to be
//  findable again when somebody opens the comment days later.
//  Where the page is annotated the source file does that job
//  far better; this is the fallback for everything else, and
//  for showing a reader *which* thing was meant.
//
//  Pure, with no DOM writes, so it can be unit tested.
//
//  A readable label for an element is *not* here: element-registry.js
//  already has `describeElement`, and a second one that truncated at a
//  different length would drift from it.
// ============================================================

/** Ids and classes a build tool generated, which change on the next deploy. */
const GENERATED = [
  /^[a-z]+-[0-9a-f]{6,}$/i,      // hashed: header-1a2b3c
  /^(css|sc|jsx?|svelte)-\w{5,}$/i, // styled-components, svelte, css modules
  /^_+\w{5,}$/,                  // CSS-module locals: _hero_1x2y3
  /^[0-9a-f]{8,}$/i,             // bare hashes
  /^ng-/, /^v-/, /^data-v-/,     // framework runtime markers
  /^(is|has)-active$/,           // state that flips as the user interacts
];

const isStable = (name) => Boolean(name) && !GENERATED.some((re) => re.test(name));

/**
 * The most specific *stable* selector for an element.
 *
 * Prefers, in order: a stable id, then a path of tag plus one stable class,
 * then nth-of-type. A generated class is worse than useless — it looks
 * precise and stops matching at the next build.
 *
 * @param {Element} el
 * @param {Element} [root] stop here; defaults to document.body
 * @returns {string}
 */
export function selectorFor(el, root) {
  if (!el || el.nodeType !== 1) return "";

  const stop = root || el.ownerDocument?.body || null;
  const parts = [];
  let node = el;

  while (node && node.nodeType === 1 && node !== stop) {
    // A stable id is unique by definition, so nothing above it matters.
    if (isStable(node.id)) {
      parts.unshift(`#${cssEscape(node.id)}`);
      return parts.join(" > ");
    }

    parts.unshift(describe(node));
    node = node.parentElement;

    // Deep enough to be unambiguous without being a brittle full path.
    if (parts.length >= 4) break;
  }

  return parts.join(" > ");
}

function describe(node) {
  const tag = node.tagName.toLowerCase();

  const className = [...(node.classList || [])].find(isStable);
  if (className) return `${tag}.${cssEscape(className)}`;

  const index = positionAmongSiblings(node);
  return index === null ? tag : `${tag}:nth-of-type(${index})`;
}

/** 1-based position among siblings of the same tag, or null when it is the only one. */
function positionAmongSiblings(node) {
  const parent = node.parentElement;
  if (!parent) return null;

  const sameTag = [...parent.children].filter((c) => c.tagName === node.tagName);
  return sameTag.length > 1 ? sameTag.indexOf(node) + 1 : null;
}

/**
 * CSS.escape where available.
 *
 * Content scripts run in the page's realm, and a page is free to have
 * deleted it — so there is a fallback rather than a thrown error mid-comment.
 */
function cssEscape(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/([^\w-])/g, "\\$1");
}

/**
 * What the Comment tool acts on.
 *
 * Anything on the page, which is the whole difference from the editing
 * tools: those are limited to elements the codemod can change, because
 * offering an edit that fails at commit time is worse than not offering it.
 * A comment has no such constraint — an image, an icon, a button, a wrapper
 * with nothing but a background are all things somebody might need to say
 * something about.
 *
 * Bounded at the top: `<html>` and `<body>` are refused, because a comment
 * on the whole document is a comment on nothing in particular, and
 * outlining the viewport looks like a bug.
 *
 * @param {EventTarget|null} target
 * @param {Document} [doc]
 * @returns {Element|null}
 */
export function commentTargetFrom(target, doc = globalThis.document) {
  if (!target || target.nodeType !== 1) return null;
  if (target === doc?.documentElement || target === doc?.body) return null;
  return target;
}

/**
 * The source annotation that applies to this element.
 *
 * An image, an icon or a button rarely carries `data-edit-file` — the
 * annotation plugin stamps elements that hold *text*, because those are what
 * the codemod can edit. But the image sits inside a component that was
 * annotated, and "somewhere in home-hero.vue" is far more use than nothing
 * at all, whether you are commenting on it or inspecting it.
 *
 * `exact` says which it is, so the caller can be honest about the difference
 * rather than implying the line is the element's own.
 *
 * @param {Element|null} el
 * @returns {{sourceFile: string|null, sourceLine: number|null, exact: boolean}}
 */
export function annotationFor(el) {
  const none = { sourceFile: null, sourceLine: null, exact: false };
  if (!el || el.nodeType !== 1) return none;

  if (el.dataset?.editFile) {
    return {
      sourceFile: el.dataset.editFile,
      sourceLine: el.dataset.editLine ? Number(el.dataset.editLine) : null,
      exact: true,
    };
  }

  const annotated = el.closest?.("[data-edit-file]");
  if (!annotated) return none;

  return {
    sourceFile: annotated.dataset.editFile,
    sourceLine: annotated.dataset.editLine ? Number(annotated.dataset.editLine) : null,
    exact: false,
  };
}
