"use strict";

// ============================================================
//  Pointing at what you mean
//
//  "The button is wrong" is a comment somebody has to go and
//  decode. "This button is wrong", with the element attached, is
//  one they can act on — and where the page is annotated, it
//  carries the source file with it.
//
//  The outline is drawn into the widget's own shadow root rather
//  than applied to the page's elements. Setting `outline` on the
//  host page's nodes means writing to styles we do not own, and
//  restoring them afterwards is guesswork if the page changed
//  them in between.
// ============================================================

/**
 * @param {object} options
 * @param {(el: Element) => void} options.onPick
 * @param {() => void} options.onCancel
 * @param {(el: Element) => boolean} [options.ignore] elements to skip
 */
export function createPicker({ onPick, onCancel, ignore = () => false }) {
  let overlay = null;
  let active = false;

  function start() {
    if (active) return;
    active = true;

    overlay = document.createElement("div");
    overlay.setAttribute("data-inline-edit-picker", "");
    overlay.style.cssText = [
      "position:fixed",
      "pointer-events:none",
      "z-index:2147482999",
      "border:2px solid #06b6d4",
      "background:rgba(6,182,212,0.12)",
      "border-radius:3px",
      "transition:all 60ms linear",
      "display:none",
    ].join(";");
    document.body.appendChild(overlay);

    // Capture phase, so the outline follows the pointer even over elements
    // that stop propagation of their own move events.
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    document.documentElement.style.cursor = "crosshair";
  }

  function stop() {
    if (!active) return;
    active = false;

    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    document.documentElement.style.cursor = "";
    overlay?.remove();
    overlay = null;
  }

  function onMove(event) {
    const element = elementUnder(event);
    if (!element) {
      overlay.style.display = "none";
      return;
    }

    const box = element.getBoundingClientRect();
    // A zero-sized box is a wrapper with no geometry of its own; outlining
    // it shows nothing and looks broken.
    if (box.width === 0 || box.height === 0) {
      overlay.style.display = "none";
      return;
    }

    overlay.style.display = "block";
    overlay.style.top = `${box.top}px`;
    overlay.style.left = `${box.left}px`;
    overlay.style.width = `${box.width}px`;
    overlay.style.height = `${box.height}px`;
  }

  function onClick(event) {
    const element = elementUnder(event);
    if (!element) return;

    // The page must not also receive this click. Picking a link would
    // otherwise navigate away, losing whatever had been typed.
    event.preventDefault();
    event.stopPropagation();

    stop();
    onPick(element);
  }

  function onKey(event) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    stop();
    onCancel();
  }

  /**
   * What is under the pointer, excluding our own UI.
   *
   * `composedPath` is read first so an element inside another shadow root on
   * the page is reachable — `event.target` would only ever report that
   * root's host.
   */
  function elementUnder(event) {
    const path = event.composedPath?.() ?? [];
    const candidate = path.find((node) => node instanceof Element && !ignore(node));

    const element = candidate ?? (event.target instanceof Element ? event.target : null);
    if (!element || ignore(element)) return null;
    if (element === document.documentElement || element === document.body) return null;

    return element;
  }

  return { start, stop };
}
