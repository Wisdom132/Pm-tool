"use strict";

import { icon } from "./icons.js";

// ============================================================
//  Structure bar
//
//  Delete, duplicate and reorder controls that follow the
//  selected element.
//
//  Structural changes are the only ones here that are not
//  reversible by retyping, so they are kept behind their own
//  tool and never fire on a stray click on the page.
// ============================================================

const P = "__iet";

const OPS = [
  { id: "move-up", icon: "arrowUp", label: "Move up" },
  { id: "move-down", icon: "arrowDown", label: "Move down" },
  { id: "duplicate", icon: "copy", label: "Duplicate" },
  { id: "delete", icon: "trash", label: "Delete", danger: true },
];

/**
 * @param {(op: string, el: Element) => void} onOp
 */
export function createStructureBar({ onOp }) {
  const bar = document.createElement("div");
  bar.id = `${P}-structure`;
  bar.hidden = true;

  let target = null;

  // Rearranging rewrites source, and source needs an annotation to be
  // found. Saying so up front — buttons disabled, one line of why — beats
  // four buttons that each refuse only after being pressed.
  const note = document.createElement("span");
  note.className = `${P}-struct-note`;
  note.textContent = "Needs a build annotation";
  note.hidden = true;

  for (const spec of OPS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${P}-struct-btn`;
    btn.dataset.op = spec.id;
    btn.setAttribute("aria-label", spec.label);
    btn.title = spec.label;
    if (spec.danger) btn.dataset.danger = "true";
    btn.appendChild(icon(spec.icon, 16));

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (target) onOp(spec.id, target);
    });

    bar.appendChild(btn);
  }
  bar.appendChild(note);

  function position(el) {
    const rect = el.getBoundingClientRect();
    const width = bar.offsetWidth || 150;
    // Above and right-aligned, so it does not sit on top of the label.
    const top = rect.top - 34 >= 4 ? rect.top - 34 : rect.bottom + 6;
    bar.style.top = `${top}px`;
    bar.style.left = `${Math.max(4, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
  }

  return {
    element: bar,

    show(el) {
      target = el;

      const sourced = Boolean(el.dataset.editFile);
      for (const btn of bar.querySelectorAll(`.${P}-struct-btn`)) {
        btn.disabled = !sourced;
      }
      note.hidden = sourced;

      bar.hidden = false;
      position(el);
    },

    hide() {
      bar.hidden = true;
      target = null;
    },

    reposition() {
      if (!bar.hidden && target?.isConnected) position(target);
    },

    get target() {
      return target;
    },

    get visible() {
      return !bar.hidden;
    },
  };
}
