"use strict";

// ============================================================
//  Alignment guides
//
//  Four dashed lines extending from the element's edges to the
//  edges of the viewport. They answer the question an outline
//  cannot: is this thing actually aligned with anything else on
//  the page?
//
//  One layer with four reused lines, repositioned on hover —
//  creating and destroying nodes as the pointer moves would
//  churn the DOM on every mousemove.
// ============================================================

const P = "__iet";

function line(orientation) {
  const el = document.createElement("div");
  el.className = `${P}-guide ${P}-guide-${orientation}`;
  return el;
}

export function createGuideLayer() {
  const layer = document.createElement("div");
  layer.className = `${P}-guides`;
  layer.hidden = true;

  const top = line("h");
  const bottom = line("h");
  const left = line("v");
  const right = line("v");

  layer.append(top, bottom, left, right);

  let enabled = true;

  function place(el) {
    const rect = el.getBoundingClientRect();
    top.style.transform = `translateY(${rect.top}px)`;
    bottom.style.transform = `translateY(${rect.bottom}px)`;
    left.style.transform = `translateX(${rect.left}px)`;
    right.style.transform = `translateX(${rect.right}px)`;
  }

  return {
    element: layer,

    /** @param {'hover'|'selected'|'edited'} state */
    show(el, state = "hover") {
      if (!enabled || !el) return;
      layer.dataset.state = state;
      place(el);
      layer.hidden = false;
    },

    hide() {
      layer.hidden = true;
    },

    reposition(el) {
      if (!layer.hidden && el) place(el);
    },

    /** Turning guides off hides them immediately. */
    setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) layer.hidden = true;
    },

    get enabled() {
      return enabled;
    },
  };
}
