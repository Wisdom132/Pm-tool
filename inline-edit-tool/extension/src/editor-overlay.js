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

/** Hides the text an overlay stands in for. Defined in page.css. */
const HIDDEN_CLASS = "__iet-text-hidden";

/**
 * Make the text the overlay stands in for invisible, and return the undo.
 *
 * When editing one run, the run is wrapped in a bare `<span>` so only that
 * run is hidden. Colouring the parent instead would inherit into its other
 * children, so `Hello <strong>world</strong>` would lose "world" too while
 * only "Hello" was being edited. The span carries no styles of its own, so
 * it does not affect layout, and the text node moves into it unchanged —
 * the caller's reference stays valid.
 *
 * @returns {() => void} idempotent restore
 */
function hideOriginal(target, textNode) {
  if (textNode && textNode.parentNode) {
    const sleeve = document.createElement("span");
    sleeve.className = HIDDEN_CLASS;
    textNode.parentNode.insertBefore(sleeve, textNode);
    sleeve.appendChild(textNode);

    return () => {
      if (!sleeve.parentNode) return;
      sleeve.parentNode.replaceChild(textNode, sleeve);
      // Rejoin the split text nodes, or the next edit sees a fragment of
      // the run it means to replace.
      target.normalize();
    };
  }

  // A class, not an inline style, so the rule can also reach descendants
  // and reset the properties that survive a transparent `color` — see
  // `.__iet-text-hidden` in page.css.
  target.classList.add(HIDDEN_CLASS);
  return () => target.classList.remove(HIDDEN_CLASS);
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

  // Read every style off the target *before* hiding it below, because
  // `getComputedStyle` returns a live object — reading `color` afterwards
  // would hand the overlay the transparent value and nothing would be
  // visible while typing.
  for (const prop of COPIED_STYLES) overlay.style[prop] = computed[prop];
  overlay.style.background = effectiveBackground(target);

  // Padding only when standing in for the whole element. When editing one
  // run of text the overlay is sized from a Range box, which already
  // excludes the element's padding — adding it back would offset the text
  // from where it sits on the page.
  overlay.style.padding = textNode ? "0px" : computed.padding;

  // ── Hide the text being replaced ──
  //
  // The overlay used to rely on its own background colour covering the
  // original. That fails whenever the real background is an image, a
  // gradient, or a colour on an ancestor the walk could not resolve, and
  // then the original shows through the text being typed — two copies of
  // the same sentence, wrapped differently, one over the other.
  //
  // Hiding the source of the duplicate is more reliable than painting over
  // it. `color: transparent` rather than `visibility: hidden` or emptying
  // the node, so the element keeps its exact box and the page does not
  // reflow underneath the overlay.
  const restoreHidden = hideOriginal(target, textNode);
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

    // A fixed width, not a minimum. With only `min-width` the overlay grew
    // to fit its content, so a long paragraph in a narrow column wrapped
    // across the whole viewport — the typed text and the original ended up
    // on different lines, overlapping each other, and neither was readable.
    //
    // Matching the box exactly is what makes the overlay look like the text
    // it replaces rather than a second copy of it.
    overlay.style.width = `${rect.width}px`;
    overlay.style.minHeight = `${rect.height}px`;
  }
  reposition();

  let settled = false;

  // Tear down *before* handing control back, so the handler sees the page
  // exactly as it was. Editing one run reparents its text node into a sleeve
  // to hide it, and a handler reading the element's child text nodes at that
  // moment would not find the run it just edited — which is how a committed
  // edit came to be recorded against an empty original and then silently
  // dropped. Nothing about the editing state should outlive the editor.
  const settle = (notify) => {
    if (settled) return;
    settled = true;
    destroy();
    notify();
  };

  // innerText rather than textContent: it reflects rendered line breaks. Read
  // before `destroy()` removes the overlay from the document.
  const commit = () => {
    const text = overlay.innerText;
    settle(() => onCommit(text));
  };

  const cancel = () => settle(onCancel);

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
    // Reveal the original first, so a failure below cannot leave the page
    // with invisible text.
    restoreHidden();

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
