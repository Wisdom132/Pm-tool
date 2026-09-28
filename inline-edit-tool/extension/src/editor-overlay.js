"use strict";

// ============================================================
//  Editing surface
//
//  Typing happens in an overlay positioned over the target, not
//  in the target itself. Making a framework-managed node
//  contentEditable loses the text on the next re-render — React
//  reconciles against its own virtual DOM and overwrites
//  whatever was typed. The page element is only written to once,
//  on commit.
// ============================================================

/** Typography copied so the overlay reads as the text it replaces. */
const COPIED_STYLES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "textAlign",
  "textTransform",
  "color",
  "textDecoration",
  "whiteSpace",
  "wordSpacing",
];

/**
 * Walk up until a non-transparent background is found.
 *
 * The target is usually transparent over some ancestor's colour, and an
 * overlay with no background would show the original text through it.
 */
export function effectiveBackground(el, getComputedStyleImpl = getComputedStyle) {
  let node = el;
  while (node && node.nodeType === 1) {
    const bg = getComputedStyleImpl(node).backgroundColor;
    if (bg && bg !== "transparent" && !/^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(bg)) {
      return bg;
    }
    node = node.parentElement;
  }
  return "#ffffff";
}

/**
 * Open an editing overlay over `target`.
 *
 * @param {Element} target
 * @param {ShadowRoot} root      where the overlay is mounted
 * @param {object} handlers
 * @param {(text: string) => void} handlers.onCommit
 * @param {() => void} handlers.onCancel
 * @returns {{destroy: () => void, reposition: () => void, element: HTMLElement}}
 */
/**
 * @param {object} options
 * @param {Text} [options.textNode] edit just this run of the element's text,
 *        for copy that sits beside another element
 */
export function openEditorOverlay(target, root, { textNode, onCommit, onCancel }) {
  const computed = getComputedStyle(target);

  const overlay = document.createElement("div");
  overlay.className = "__iet-edit-overlay";
  overlay.contentEditable = "plaintext-only";
  overlay.spellcheck = false;
  overlay.textContent = textNode ? textNode.textContent.trim() : target.innerText;

  for (const prop of COPIED_STYLES) overlay.style[prop] = computed[prop];
  overlay.style.background = effectiveBackground(target);
  overlay.style.padding = computed.padding;

  /** The run's own box when editing one, otherwise the element's. */
  function box() {
    if (!textNode || !textNode.isConnected) return target.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rect = range.getBoundingClientRect();
    // A run that has wrapped across lines has no single usable box; fall
    // back to the element rather than draw the overlay somewhere wrong.
    return rect.width > 0 && rect.height > 0 ? rect : target.getBoundingClientRect();
  }

  function reposition() {
    const rect = box();
    overlay.style.top = `${rect.top}px`;
    overlay.style.left = `${rect.left}px`;
    overlay.style.minWidth = `${rect.width}px`;
    overlay.style.minHeight = `${rect.height}px`;
  }
  reposition();

  let settled = false;

  const commit = () => {
    if (settled) return;
    settled = true;
    // innerText rather than textContent: it reflects rendered line breaks.
    onCommit(overlay.innerText);
    destroy();
  };

  const cancel = () => {
    if (settled) return;
    settled = true;
    onCancel();
    destroy();
  };

  overlay.addEventListener("keydown", (e) => {
    // Let undo/redo fall through to the document-level handler.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
    e.stopPropagation();
  });

  overlay.addEventListener("blur", commit);
  // Clicks inside the overlay must not reach the page underneath.
  overlay.addEventListener("click", (e) => e.stopPropagation());

  // The overlay is fixed-positioned, so it has to follow the page.
  const onScrollOrResize = () => reposition();
  window.addEventListener("scroll", onScrollOrResize, true);
  window.addEventListener("resize", onScrollOrResize);

  function destroy() {
    window.removeEventListener("scroll", onScrollOrResize, true);
    window.removeEventListener("resize", onScrollOrResize);
    overlay.remove();
  }

  root.appendChild(overlay);

  overlay.focus();
  // Caret to the end.
  const range = document.createRange();
  range.selectNodeContents(overlay);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  return { destroy, reposition, element: overlay };
}
