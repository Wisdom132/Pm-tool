"use strict";

// ============================================================
//  Element labels
//
//  The badge that rides above a hovered or selected element,
//  naming the tag and — unlike a generic design tool — the
//  source file the text came from. Knowing a heading lives at
//  Hero.tsx:12 is the whole point of this editor, so it earns
//  its place next to the tag name.
// ============================================================

import { annotationFor } from "../element-selector.js";

const P = "__iet";

/** Classes worth showing: the page's own, never our decorations. */
function pageClasses(el, limit = 3) {
  return Array.from(el.classList)
    .filter((c) => !c.startsWith(P))
    .slice(0, limit);
}

/** "src/components/Hero.tsx:12" shortened to "Hero.tsx:12". */
function shortSource(el) {
  const file = el.dataset.editFile;
  if (!file) return null;
  const name = file.split("/").pop();
  return el.dataset.editLine ? `${name}:${el.dataset.editLine}` : name;
}

function describe(el) {
  const tag = el.tagName.toLowerCase();
  const classes = pageClasses(el);
  return `<${tag}>${classes.length ? `.${classes.join(".")}` : ""}`;
}

/**
 * Create the label layer. One element is reused for every hover rather than
 * created and destroyed, so fast pointer movement does not churn the DOM.
 */
export function createLabelLayer() {
  const label = document.createElement("div");
  label.className = `${P}-label`;
  label.hidden = true;

  const tagPart = document.createElement("span");
  tagPart.className = `${P}-label-tag`;

  const srcPart = document.createElement("span");
  srcPart.className = `${P}-label-src`;

  const flagPart = document.createElement("span");
  flagPart.className = `${P}-label-flag`;

  label.append(tagPart, srcPart, flagPart);

  return {
    element: label,

    /**
     * @param {Element} el
     * @param {{state?: 'hover'|'selected'|'edited', flag?: string}} options
     */
    show(el, { state = "hover", flag = null } = {}) {
      tagPart.textContent = describe(el);

      const source = shortSource(el);
      srcPart.textContent = source || "no source map";
      srcPart.dataset.unmapped = source ? "false" : "true";

      const i18nKey = el.dataset.editI18nKey;
      const flagText = flag || (i18nKey ? `i18n · ${i18nKey}` : null);
      flagPart.textContent = flagText || "";
      flagPart.hidden = !flagText;

      label.dataset.state = state;
      label.hidden = false;

      position(el);
    },

    hide() {
      label.hidden = true;
    },

    reposition(el) {
      if (!label.hidden && el) position(el);
    },
  };

  function position(el) {
    const rect = el.getBoundingClientRect();
    // Measure before deciding which side to sit on.
    const height = label.offsetHeight || 20;
    const above = rect.top - height - 6;

    // Drop below the element when there is no room above it.
    label.style.top = `${above >= 4 ? above : Math.min(rect.bottom + 6, window.innerHeight - height - 4)}px`;
    label.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - label.offsetWidth - 4))}px`;
  }
}

/**
 * Detail card shown when the Inspect tool is used on an element.
 * Everything the service will be told about this edit, in one place.
 */
export function createInspectorCard() {
  const card = document.createElement("div");
  card.id = `${P}-inspector`;
  card.hidden = true;

  return {
    element: card,

    show(el) {
      card.textContent = "";

      const title = document.createElement("div");
      title.className = `${P}-inspector-title`;
      title.textContent = describe(el);
      card.appendChild(title);

      // An element's own annotation, or the nearest annotated ancestor's.
      // An image is never stamped — the plugin annotates elements holding
      // text — so without this the card is empty for exactly the things
      // somebody inspects when they cannot tell what drew them.
      const annotation = annotationFor(el);

      const rows = [
        [annotation.exact ? "Source file" : "Rendered in", annotation.sourceFile],
        ["Line", annotation.sourceLine],
        ["Framework", el.dataset.editFramework || nearestData(el, "editFramework")],
        ["Translation key", el.dataset.editI18nKey || null],
        ...mediaRows(el),
        ["Text", (el.innerText || "").trim().slice(0, 120) || null],
      ];

      const list = document.createElement("dl");
      list.className = `${P}-inspector-rows`;

      for (const [name, value] of rows) {
        if (!value) continue;
        const dt = document.createElement("dt");
        dt.textContent = name;
        const dd = document.createElement("dd");
        dd.textContent = value;
        list.append(dt, dd);
      }
      card.appendChild(list);

      if (!annotation.sourceFile) {
        const note = document.createElement("p");
        note.className = `${P}-inspector-note`;
        note.textContent = (el.innerText || "").trim()
          ? "No build annotation here. The service will search the repository for this text, which is slower and can be ambiguous."
          : "No build annotation here, and no text to search for. Add the annotation plugin to see which component drew this.";
        card.appendChild(note);
      } else if (!annotation.exact) {
        const note = document.createElement("p");
        note.className = `${P}-inspector-note`;
        note.textContent =
          "This element is not annotated itself — the file above is the nearest annotated ancestor, so it is where to look rather than the exact line.";
        card.appendChild(note);
      }

      const rect = el.getBoundingClientRect();
      card.hidden = false;
      card.style.top = `${Math.min(rect.bottom + 10, window.innerHeight - card.offsetHeight - 10)}px`;
      card.style.left = `${Math.max(70, Math.min(rect.left, window.innerWidth - card.offsetWidth - 10))}px`;
    },

    hide() {
      card.hidden = true;
    },

    get visible() {
      return !card.hidden;
    },
  };
}

/** The nearest ancestor carrying a data attribute, for inherited context. */
function nearestData(el, key) {
  const attr = `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
  return el.closest?.(`[${attr}]`)?.dataset?.[key] || null;
}

/**
 * What an image, video or icon is, when it has no text to describe it.
 *
 * `naturalWidth` rather than the rendered box: somebody inspecting an image
 * usually wants to know whether a 4000px original is being served into a
 * 400px slot, and the rendered size alone cannot say.
 */
function mediaRows(el) {
  const tag = el.tagName.toLowerCase();
  if (!["img", "video", "source", "picture", "svg", "iframe"].includes(tag)) return [];

  const src = el.getAttribute("src") || el.getAttribute("srcset") || "";
  const rows = [];

  if (src) rows.push(["Source", src.startsWith("data:") ? "inline data URI" : src.split(/[?#]/)[0]]);
  if (el.getAttribute("alt") !== null) rows.push(["Alt text", el.getAttribute("alt") || "(empty — decorative)"]);

  if (tag === "img" && el.naturalWidth) {
    const rect = el.getBoundingClientRect();
    const natural = `${el.naturalWidth}×${el.naturalHeight}`;
    const shown = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
    rows.push(["Intrinsic size", natural === shown ? natural : `${natural} (shown at ${shown})`]);
  }

  return rows;
}
