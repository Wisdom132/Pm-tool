"use strict";

// ============================================================
//  Design
//
//  Padding, margin, type, radius, shadow, opacity — the things
//  VisBug made famous, with one difference that is the whole
//  point: these edits survive.
//
//  VisBug writes an inline style, which dies on refresh. This
//  writes the utility class the codebase already uses, so the
//  change goes through the same path as any other class edit
//  and arrives as a reviewable line in a pull request.
//
//  Where a page does not use utility classes there is nothing
//  honest to step, and the panel says so rather than inventing
//  markup nobody on that team writes.
// ============================================================

import {
  MODES,
  PROPERTIES,
  nearestSpacing,
  findMode,
  findUtilityClass,
  stepClass,
  stepMode,
  usesUtilityClasses,
} from "./class-scale.js";

const P = "__iet";

/**
 * Shown in this order: the ones people reach for most, first.
 *
 * `kind` decides how the arrows behave. A scale has ends worth refusing at;
 * a mode is a cycle of alternatives where "one more" means nothing, so it
 * wraps instead.
 */
const ROWS = [
  { id: "padding", label: "Padding", kind: "scale" },
  { id: "margin", label: "Margin", kind: "scale" },
  { id: "gap", label: "Gap", kind: "scale" },
  { id: "fontSize", label: "Text size", kind: "scale" },
  { id: "fontWeight", label: "Weight", kind: "scale" },
  { id: "radius", label: "Radius", kind: "scale" },
  { id: "shadow", label: "Shadow", kind: "scale" },
  { id: "opacity", label: "Opacity", kind: "scale" },

  // Positioning. Below the rest because it is reached for less often, and
  // because setting a position mode is what unlocks the offsets beneath it.
  { id: "position", label: "Position", kind: "mode" },
  { id: "top", label: "Top", kind: "scale", needs: "position" },
  { id: "right", label: "Right", kind: "scale", needs: "position" },
  { id: "bottom", label: "Bottom", kind: "scale", needs: "position" },
  { id: "left", label: "Left", kind: "scale", needs: "position" },
  { id: "zIndex", label: "Z-index", kind: "scale", needs: "position" },
];

/** A row's label, for messages. */
const labelOf = (id) => ROWS.find((r) => r.id === id)?.label ?? id;

/**
 * @param {object} opts
 * @param {(change: {attribute: string, originalValue: string, newValue: string}) => void} opts.onChange
 *        the same shape the properties panel emits, so both share one
 *        recording path and therefore one route into a pull request
 */
export function createDesignPanel({ onChange }) {
  const card = document.createElement("div");
  card.id = `${P}-design`;
  card.hidden = true;

  let target = null;
  /** Which row the arrow keys act on. */
  let focused = ROWS[0].id;

  /** The attribute name this element's framework uses for classes. */
  function classAttr(el) {
    return el.dataset.editFramework === "react" ? "className" : "class";
  }

  /** The page's own classes, never our decorations. */
  function pageClasses(el) {
    return Array.from(el.classList).filter((c) => !c.startsWith(P));
  }

  /**
   * Step one element. Separate from `apply` so a multi-selection can drive
   * it per element without the panel's own target being involved.
   *
   * @returns {boolean} whether anything changed
   */
  function applyTo(el, property, direction) {
    if (!el) return false;

    const before = pageClasses(el);
    const row = ROWS.find((r) => r.id === property);
    const result =
      row?.kind === "mode"
        ? stepMode(before, property, direction)
        : stepClass(before, property, direction);
    if (!result) return false;

    // Our own decoration classes are preserved: they live on the same
    // attribute but are not the page's, and writing them into source would
    // put editor state into the repository.
    const ours = Array.from(el.classList).filter((c) => c.startsWith(P));
    el.className = [...result.classes, ...ours].join(" ");

    onChange({
      // Named explicitly: the recorder cannot infer it from the properties
      // panel, which is not open when this one is.
      element: el,
      attribute: classAttr(el),
      originalValue: before.join(" "),
      newValue: result.classes.join(" "),
    });

    return true;
  }

  function apply(property, direction) {
    if (!target) return;

    if (!applyTo(target, property, direction)) {
      flash(property, direction > 0 ? "at the largest" : "at the smallest");
      return;
    }

    render(target);
  }

  function flash(property, message) {
    const row = card.querySelector(`[data-row="${property}"] .${P}-design-value`);
    if (!row) return;
    const was = row.textContent;
    row.textContent = message;
    row.dataset.flash = "true";
    setTimeout(() => {
      row.textContent = was;
      delete row.dataset.flash;
    }, 1200);
  }

  function render(el) {
    card.textContent = "";

    const title = document.createElement("div");
    title.className = `${P}-design-title`;
    title.textContent = `<${el.tagName.toLowerCase()}>`;
    card.appendChild(title);

    if (!usesUtilityClasses(el.ownerDocument || document)) {
      const note = document.createElement("p");
      note.className = `${P}-design-note`;
      note.textContent =
        "This page does not use utility classes, so there is no class to step. Editing one here would add markup the codebase does not otherwise use.";
      card.appendChild(note);
      card.hidden = false;
      return;
    }

    const list = document.createElement("div");
    list.className = `${P}-design-rows`;

    for (const row of ROWS) {
      const line = document.createElement("div");
      line.className = `${P}-design-row`;
      line.dataset.row = row.id;
      if (row.id === focused) line.dataset.focused = "true";

      const label = document.createElement("span");
      label.className = `${P}-design-label`;
      label.textContent = row.label;

      const classes = pageClasses(el);
      const current =
        row.kind === "mode" ? findMode(classes, row.id) : findUtilityClass(classes, row.id);

      const value = document.createElement("span");
      value.className = `${P}-design-value`;
      // The class name itself, not a pixel value: it is what will appear in
      // the diff, and seeing it is how somebody learns the scale.
      value.textContent = current ? current.className : "—";

      // `top-4` does nothing on a statically positioned element. Showing the
      // row but dimming it says why the key had no effect, which an absent
      // row does not.
      const mode = findMode(classes, "position");
      const inert = row.needs === "position" && (!mode || mode.value === "static");
      if (inert) line.dataset.inert = "true";

      const minus = stepButton("−", () => {
        focused = row.id;
        apply(row.id, -1);
      });
      const plus = stepButton("+", () => {
        focused = row.id;
        apply(row.id, 1);
      });

      line.append(label, value, minus, plus);
      line.addEventListener("click", () => {
        focused = row.id;
        render(el);
      });
      list.appendChild(line);
    }

    card.appendChild(list);

    const hint = document.createElement("p");
    hint.className = `${P}-design-hint`;
    const positioned = findMode(pageClasses(el), "position");
    hint.textContent =
      positioned && positioned.value !== "static"
        ? "↑ ↓ step · click a row to move it · drag the element to place it"
        : "↑ ↓ step the highlighted row · click a row to move it";
    card.appendChild(hint);

    card.hidden = false;
  }

  function stepButton(glyph, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `${P}-design-step`;
    b.textContent = glyph;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  // ── Drag to place ─────────────────────────────────────────
  //
  //  VisBug's Position tool drags an element and writes
  //  `left: 347px` inline. The gesture is right and the output is not:
  //  that number came from where a mouse happened to stop, and no
  //  codebase wants it in source.
  //
  //  Same gesture, snapped. The offset lands on the nearest step of the
  //  spacing scale — `left-12`, not `left-[47px]` — so a drag produces the
  //  class somebody would have written, and the pull request reads like a
  //  decision rather than an accident.
  let drag = null;

  function onDragStart(e) {
    if (!target || e.button !== 0) return;

    const mode = findMode(pageClasses(target), "position");
    // Static elements ignore offsets, so dragging one would move nothing.
    if (!mode || mode.value === "static") return;
    if (!target.contains(e.target) && target !== e.target) return;

    e.preventDefault();
    e.stopPropagation();

    const left = findUtilityClass(pageClasses(target), "left");
    const top = findUtilityClass(pageClasses(target), "top");

    drag = {
      x: e.clientX,
      y: e.clientY,
      // Where it started, in scale steps, so the drag is relative to what
      // is already set rather than snapping back to zero on first move.
      fromLeft: left ? Number(left.value) * (left.negative ? -1 : 1) || 0 : 0,
      fromTop: top ? Number(top.value) * (top.negative ? -1 : 1) || 0 : 0,
    };

    window.addEventListener("mousemove", onDragMove, true);
    window.addEventListener("mouseup", onDragEnd, true);
  }

  function onDragMove(e) {
    if (!drag || !target) return;
    e.preventDefault();

    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const dx = nearestSpacing(e.clientX - drag.x, rem);
    const dy = nearestSpacing(e.clientY - drag.y, rem);

    // Live preview only — nothing is recorded until the pointer is
    // released, or a drag across the page would stage forty edits.
    target.style.setProperty("--iet-drag-x", `${e.clientX - drag.x}px`);
    target.style.setProperty("--iet-drag-y", `${e.clientY - drag.y}px`);
    target.style.transform = `translate(${e.clientX - drag.x}px, ${e.clientY - drag.y}px)`;

    preview = { dx, dy };
  }

  let preview = null;

  function onDragEnd() {
    window.removeEventListener("mousemove", onDragMove, true);
    window.removeEventListener("mouseup", onDragEnd, true);

    if (!drag || !target) {
      drag = null;
      return;
    }

    // The preview transform goes before the real change, so the element
    // does not briefly show both.
    target.style.transform = "";
    target.style.removeProperty("--iet-drag-x");
    target.style.removeProperty("--iet-drag-y");

    if (preview) {
      placeAt(target, drag.fromLeft, drag.fromTop, preview);
    }

    drag = null;
    preview = null;
    render(target);
  }

  /** Write the snapped offsets as classes, in one recorded change. */
  function placeAt(el, fromLeft, fromTop, { dx, dy }) {
    const before = pageClasses(el);

    const stepsOf = (v) => (v === "px" ? 0.25 : Number(v) || 0);
    const leftSteps = fromLeft + (dx.negative ? -stepsOf(dx.value) : stepsOf(dx.value));
    const topSteps = fromTop + (dy.negative ? -stepsOf(dy.value) : stepsOf(dy.value));

    const named = (prefix, steps) => {
      const { value, negative } = nearestSpacing(Math.abs(steps) * 4, 16);
      const name = `${prefix}-${value}`;
      return steps < 0 ? `-${name}` : name;
    };

    const kept = before.filter((c) => !/^-?(left|top)-/.test(c));
    const after = [...kept, named("left", leftSteps), named("top", topSteps)];

    const ours = Array.from(el.classList).filter((c) => c.startsWith(P));
    el.className = [...after, ...ours].join(" ");

    onChange({
      element: el,
      attribute: classAttr(el),
      originalValue: before.join(" "),
      newValue: after.join(" "),
    });
  }

  function position(el) {
    const rect = el.getBoundingClientRect();
    const height = card.offsetHeight || 280;
    const width = card.offsetWidth || 260;

    const below = rect.bottom + 8;
    card.style.top = `${
      below + height <= window.innerHeight - 8 ? below : Math.max(8, window.innerHeight - height - 8)
    }px`;
    card.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
  }

  return {
    element: card,

    show(el) {
      target = el;
      render(el);
      position(el);
    },

    /** Begin a drag, if this element is positioned. Called from the page. */
    beginDrag(e) {
      onDragStart(e);
      return Boolean(drag);
    },

    hide() {
      card.hidden = true;
      target = null;
    },

    get visible() {
      return !card.hidden;
    },

    get target() {
      return target;
    },

    reposition() {
      if (!card.hidden && target?.isConnected) position(target);
    },

    /** Arrow keys, while the panel is open. */
    step(direction) {
      apply(focused, direction);
    },

    /**
     * Step a specific element on the focused row, for a multi-selection.
     * The panel re-reads from its own target afterwards.
     */
    applyTo(el, direction) {
      const changed = applyTo(el, focused, direction);
      if (changed && el === target) render(target);
      return changed;
    },

    /** Which row the arrows are pointed at, for a caller that needs to say. */
    get focusedRow() {
      return focused;
    },

    /** Move the highlight between rows. */
    moveFocus(direction) {
      const i = ROWS.findIndex((r) => r.id === focused);
      const next = Math.max(0, Math.min(ROWS.length - 1, i + direction));
      focused = ROWS[next].id;
      if (target) render(target);
    },
  };
}

export { PROPERTIES, ROWS };
