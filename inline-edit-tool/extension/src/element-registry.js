"use strict";

// ============================================================
//  Element registry
//
//  Maps DOM elements to stable string keys, finds editable
//  elements, and watches for the re-renders that would otherwise
//  drop listeners and orphan pending edits.
// ============================================================

export const EDITABLE_SELECTOR = '[data-editable="true"]';

/** Auto-detect fallback when no annotation plugin is present. */
export const TEXT_SELECTOR =
  "p,h1,h2,h3,h4,h5,h6,span,a,button,label,li,td,th,strong,em,small,b,i,div";

/** True if the element has at least one non-empty direct text node. */
export function hasDirectText(el) {
  for (const node of el.childNodes) {
    if (node.nodeType === 3 && node.textContent.trim().length > 0) return true;
  }
  return false;
}

/**
 * Position of `el` among its siblings of the same tag, 1-based.
 * Mirrors :nth-of-type so the path stays valid as a CSS selector.
 */
function nthOfType(el) {
  let n = 1;
  let sibling = el.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === el.tagName) n++;
    sibling = sibling.previousElementSibling;
  }
  return n;
}

/** Structural path from <body>, used when no source annotation exists. */
export function domPath(el, root = null) {
  const parts = [];
  let node = el;

  while (node && node.nodeType === 1 && node.tagName !== "BODY" && node !== root) {
    parts.unshift(`${node.tagName.toLowerCase()}:${nthOfType(node)}`);
    node = node.parentElement;
  }

  return parts.join(">");
}

/**
 * A stable identity for an element.
 *
 * The annotation plugin already emits a unique coordinate per element, which
 * survives re-renders and even a full page reload. Only the auto-detect path
 * needs a positional fallback, which is weaker — moving an element changes
 * its key.
 */
export function editKey(el) {
  const { editFile, editLine, editCol } = el.dataset;
  if (editFile && editLine !== undefined) {
    return `src:${editFile}:${editLine}:${editCol ?? 0}`;
  }
  return `dom:${domPath(el)}`;
}

/**
 * Find every element that should be editable.
 *
 * Annotated elements and detected ones, together — not one or the other.
 *
 * A page is rarely all or nothing. Copy held in a data array and rendered
 * through an interpolation has no literal text in the template to annotate,
 * so it arrives unannotated on a page where everything else is traced. This
 * used to make it unreachable: the annotated branch won, and clicking the
 * text did nothing at all. It is now editable, and its source is resolved by
 * the Locate flow at review time instead of by an annotation.
 *
 * `autoDetected` still means what it did — that *nothing* here is annotated,
 * which is what puts the whole session into observer mode.
 *
 * @param {Document|Element} root
 * @param {(el: Element) => boolean} isExcluded  skip our own UI
 * @returns {{elements: Element[], detected: Element[], autoDetected: boolean}}
 */
export function findEditableElements(root, isExcluded = () => false) {
  // Elements marked by a previous scan carry data-editable too; excluding
  // them here keeps them from being counted as annotated on the next pass.
  const annotated = Array.from(
    root.querySelectorAll(`${EDITABLE_SELECTOR}:not([data-auto-detected])`)
  ).filter((el) => !isExcluded(el));

  const seen = new Set(annotated);
  const detected = Array.from(root.querySelectorAll(TEXT_SELECTOR)).filter(
    (el) =>
      !seen.has(el) &&
      !isExcluded(el) &&
      hasDirectText(el) &&
      // A duplicate this tool previewed is not page content to edit; it is
      // the pending edit's own preview, and it disappears on undo.
      !el.closest("[data-iet-copy]")
  );

  return {
    elements: [...annotated, ...detected],
    detected,
    autoDetected: annotated.length === 0,
  };
}

/**
 * The chain of editable ancestors from outermost to the element itself.
 * Backs the breadcrumb, which is how a nested element is reached when its
 * parent is editable too.
 */
export function editableAncestors(el, isEditable) {
  const chain = [];
  let node = el;
  while (node && node.nodeType === 1) {
    if (isEditable(node)) chain.unshift(node);
    node = node.parentElement;
  }
  return chain;
}

/** Short label for a breadcrumb entry. */
export function describeElement(el) {
  const tag = el.tagName.toLowerCase();

  const text = (el.textContent || "").trim().replace(/\s+/g, " ");
  if (text) return `${tag} · ${text.length > 24 ? `${text.slice(0, 24)}…` : text}`;

  // No text is the normal case for an image, an icon or a decorated
  // wrapper, and a bare "img" tells a reader nothing about which one was
  // meant — which matters most when they are looking at a comment somebody
  // else left days ago.
  const label = labelWithoutText(el);
  return label ? `${tag} · ${label.length > 24 ? `${label.slice(0, 24)}…` : label}` : tag;
}

/** Whatever names an element that has no text of its own. */
function labelWithoutText(el) {
  const attr = (name) => el.getAttribute?.(name)?.trim();

  // Alt text first: it is the one written *for* a human.
  return (
    attr("alt") ||
    attr("aria-label") ||
    attr("title") ||
    fileNameOf(attr("src")) ||
    attr("name") ||
    attr("placeholder") ||
    ""
  );
}

/** "…/images/hero-laundry.webp?v=2" → "hero-laundry.webp" */
function fileNameOf(src) {
  if (!src || src.startsWith("data:")) return "";
  const path = src.split(/[?#]/)[0];
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Watch for DOM changes and report when a rescan is warranted.
 *
 * Frameworks replace nodes wholesale on re-render, which drops event
 * listeners, clears decoration classes and reverts edited text. Mutations are
 * coalesced into one callback per frame-ish window so a busy page does not
 * trigger a rescan per node.
 *
 * @returns {{disconnect: () => void, pause: () => void, resume: () => void}}
 */
export function observeDom(target, onChange, { debounceMs = 120, MutationObserverImpl } = {}) {
  const Impl =
    MutationObserverImpl || (typeof MutationObserver !== "undefined" ? MutationObserver : null);
  if (!Impl) return { disconnect() {}, pause() {}, resume() {} };

  let timer = null;
  let paused = false;

  const observer = new Impl((records) => {
    if (paused) return;

    // Ignore mutations we caused ourselves — re-applying an edit's text or
    // toggling a decoration class must not feed back into another rescan.
    const relevant = records.some((r) => {
      if (r.type === "attributes") return r.attributeName !== "class";
      return r.addedNodes.length > 0 || r.removedNodes.length > 0;
    });
    if (!relevant) return;

    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  });

  observer.observe(target, {
    childList: true,
    subtree: true,
    characterData: false,
    attributes: true,
    attributeFilter: ["data-editable", "data-edit-file"],
  });

  return {
    disconnect() {
      clearTimeout(timer);
      observer.disconnect();
    },
    pause() {
      paused = true;
    },
    resume() {
      // Drain anything queued while paused so our own writes are not replayed.
      observer.takeRecords?.();
      paused = false;
    },
  };
}
