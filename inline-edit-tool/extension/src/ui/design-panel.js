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

import { PROPERTIES, findUtilityClass, stepClass, usesUtilityClasses } from "./class-scale.js";

const P = "__iet";

/** Shown in this order: the ones people reach for most, first. */
const ROWS = [
  { id: "padding", label: "Padding", hint: "p" },
  { id: "margin", label: "Margin", hint: "m" },
  { id: "gap", label: "Gap", hint: "gap" },
  { id: "fontSize", label: "Text size", hint: "text" },
  { id: "fontWeight", label: "Weight", hint: "font" },
  { id: "radius", label: "Radius", hint: "rounded" },
  { id: "shadow", label: "Shadow", hint: "shadow" },
  { id: "opacity", label: "Opacity", hint: "opacity" },
];

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

  function apply(property, direction) {
    if (!target) return;

    const before = pageClasses(target);
    const result = stepClass(before, property, direction);

    if (!result) {
      flash(property, direction > 0 ? "at the largest" : "at the smallest");
      return;
    }

    // Our own decoration classes are preserved: they live on the same
    // attribute but are not the page's, and writing them into source would
    // put editor state into the repository.
    const ours = Array.from(target.classList).filter((c) => c.startsWith(P));
    target.className = [...result.classes, ...ours].join(" ");

    onChange({
      // Named explicitly: the recorder cannot infer it from the properties
      // panel, which is not open when this one is.
      element: target,
      attribute: classAttr(target),
      originalValue: before.join(" "),
      newValue: result.classes.join(" "),
    });

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

      const current = findUtilityClass(pageClasses(el), row.id);
      const value = document.createElement("span");
      value.className = `${P}-design-value`;
      // The class name itself, not a pixel value: it is what will appear in
      // the diff, and seeing it is how somebody learns the scale.
      value.textContent = current ? current.className : "—";

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
    hint.textContent = "↑ ↓ step the highlighted row · click a row to move it";
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
