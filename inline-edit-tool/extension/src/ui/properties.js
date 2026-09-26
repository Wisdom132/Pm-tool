"use strict";

// ============================================================
//  Properties panel
//
//  Everything about an element that is not its text: attributes
//  (alt, href, title, aria-label…), its classes, and the image
//  it points at.
//
//  Only attributes the element actually has are offered. The
//  codemod rewrites a string literal that already exists in the
//  source; there is nothing to rewrite for an attribute that was
//  never written, and inventing one would be a different change
//  than the editor thinks they are making.
// ============================================================

const P = "__iet";

/** Attributes worth exposing, in the order they are shown. */
export const EDITABLE_ATTRS = [
  { name: "alt", label: "Alt text", hint: "Describes the image to screen readers" },
  { name: "src", label: "Source", hint: "Image path or URL", kind: "image" },
  { name: "href", label: "Link", hint: "Where this goes" },
  { name: "title", label: "Tooltip", hint: "Native browser tooltip" },
  { name: "aria-label", label: "ARIA label", hint: "Accessible name" },
  { name: "placeholder", label: "Placeholder" },
];

/** Class names already used on the page — the most relevant suggestions there are. */
export function collectPageClasses(doc = document, limit = 400) {
  const seen = new Set();
  for (const el of doc.querySelectorAll("[class]")) {
    for (const name of el.classList) {
      if (!name.startsWith(P)) seen.add(name);
      if (seen.size >= limit) return [...seen];
    }
  }
  return [...seen];
}

/** Rank suggestions: prefix matches first, then substring, shortest first. */
export function suggestClasses(query, pool, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const prefix = [];
  const contains = [];

  for (const name of pool) {
    const lower = name.toLowerCase();
    if (lower === q) continue;
    if (lower.startsWith(q)) prefix.push(name);
    else if (lower.includes(q)) contains.push(name);
  }

  const byLength = (a, b) => a.length - b.length || a.localeCompare(b);
  return [...prefix.sort(byLength), ...contains.sort(byLength)].slice(0, limit);
}

/** The class attribute's name in source differs between JSX and HTML. */
export function classAttributeFor(el) {
  return el.dataset.editFramework === "react" ? "className" : "class";
}

/**
 * @param {object} opts
 * @param {ShadowRoot} opts.root
 * @param {(change: {attribute: string, originalValue: string, newValue: string}) => void} opts.onChange
 * @param {(el: Element) => void} [opts.onPickImage]
 */
export function createPropertiesPanel({ root, onChange, onPickImage }) {
  const card = document.createElement("div");
  card.id = `${P}-properties`;
  card.hidden = true;

  let target = null;
  let classPool = [];

  // Clicks inside must not reach the page underneath.
  card.addEventListener("click", (e) => e.stopPropagation());
  card.addEventListener("mousedown", (e) => e.stopPropagation());

  function heading(el) {
    const title = document.createElement("div");
    title.className = `${P}-properties-title`;
    title.textContent = `<${el.tagName.toLowerCase()}>`;
    return title;
  }

  function section(label) {
    const wrap = document.createElement("div");
    wrap.className = `${P}-prop-section`;
    const head = document.createElement("div");
    head.className = `${P}-prop-section-head`;
    head.textContent = label;
    wrap.appendChild(head);
    return wrap;
  }

  /** One attribute row: label, input, and a live-updating value. */
  function attributeRow(el, spec) {
    const original = el.getAttribute(spec.name);

    const row = document.createElement("div");
    row.className = `${P}-prop-row`;

    const label = document.createElement("label");
    label.className = `${P}-prop-label`;
    label.textContent = spec.label;
    if (spec.hint) label.title = spec.hint;

    const input = document.createElement("input");
    input.type = "text";
    input.className = `${P}-prop-input`;
    input.value = original;
    input.spellcheck = false;

    const commit = () => {
      const next = input.value;
      if (next === el.getAttribute(spec.name)) return;
      el.setAttribute(spec.name, next);
      onChange({ attribute: spec.name, originalValue: original, newValue: next });
    };

    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
        input.blur();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        input.value = el.getAttribute(spec.name);
        input.blur();
      }
    });
    input.addEventListener("blur", commit);

    row.append(label, input);

    if (spec.kind === "image" && onPickImage) {
      const pick = document.createElement("button");
      pick.type = "button";
      pick.className = `${P}-prop-pick`;
      pick.textContent = "Replace…";
      pick.addEventListener("click", () => onPickImage(el));
      row.appendChild(pick);
    }

    return row;
  }

  /** Class chips plus an input that suggests classes already used on the page. */
  function classEditor(el) {
    const attrName = classAttributeFor(el);
    const originalValue = currentClasses(el).join(" ");

    const wrap = section(`Classes · ${attrName}`);

    const chips = document.createElement("div");
    chips.className = `${P}-chips`;
    wrap.appendChild(chips);

    const inputWrap = document.createElement("div");
    inputWrap.className = `${P}-chip-input-wrap`;

    const input = document.createElement("input");
    input.type = "text";
    input.className = `${P}-chip-input`;
    input.placeholder = "Add a class…";
    input.spellcheck = false;

    const suggestions = document.createElement("div");
    suggestions.className = `${P}-suggestions`;
    suggestions.hidden = true;

    inputWrap.append(input, suggestions);
    wrap.appendChild(inputWrap);

    function apply(next) {
      // Our own decoration classes are not the page's, so they are preserved
      // separately rather than being written into the source.
      const ours = [...el.classList].filter((c) => c.startsWith(P));
      el.className = [...next, ...ours].join(" ");
      onChange({
        attribute: attrName,
        originalValue,
        newValue: next.join(" "),
      });
      renderChips();
    }

    function renderChips() {
      chips.textContent = "";
      const names = currentClasses(el);

      if (names.length === 0) {
        const empty = document.createElement("span");
        empty.className = `${P}-chips-empty`;
        empty.textContent = "No classes";
        chips.appendChild(empty);
      }

      for (const name of names) {
        const chip = document.createElement("span");
        chip.className = `${P}-chip`;

        const text = document.createElement("span");
        text.textContent = name;

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = `${P}-chip-remove`;
        remove.setAttribute("aria-label", `Remove ${name}`);
        remove.textContent = "×";
        remove.addEventListener("click", () =>
          apply(currentClasses(el).filter((c) => c !== name))
        );

        chip.append(text, remove);
        chips.appendChild(chip);
      }
    }

    function addClass(name) {
      const clean = name.trim();
      if (!clean) return;
      const names = currentClasses(el);
      if (!names.includes(clean)) apply([...names, clean]);
      input.value = "";
      suggestions.hidden = true;
    }

    input.addEventListener("input", () => {
      const matches = suggestClasses(input.value, classPool);
      suggestions.textContent = "";
      suggestions.hidden = matches.length === 0;

      for (const name of matches) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = `${P}-suggestion`;
        option.textContent = name;
        option.addEventListener("click", () => addClass(name));
        suggestions.appendChild(option);
      }
    });

    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        // Take the top suggestion when one is showing, else the raw text.
        addClass(suggestions.firstChild?.textContent || input.value);
      }
      if (e.key === "Escape") {
        suggestions.hidden = true;
        input.value = "";
      }
    });

    renderChips();
    return wrap;
  }

  function currentClasses(el) {
    return [...el.classList].filter((c) => !c.startsWith(P));
  }

  return {
    element: card,

    show(el) {
      target = el;
      classPool = collectPageClasses(el.ownerDocument || document);
      card.textContent = "";
      card.appendChild(heading(el));

      const present = EDITABLE_ATTRS.filter((spec) => el.hasAttribute(spec.name));

      if (present.length > 0) {
        const attrs = section("Attributes");
        for (const spec of present) attrs.appendChild(attributeRow(el, spec));
        card.appendChild(attrs);
      } else {
        const none = document.createElement("p");
        none.className = `${P}-prop-note`;
        none.textContent =
          "This element has no editable attributes. Only attributes already written in the source can be changed.";
        card.appendChild(none);
      }

      card.appendChild(classEditor(el));

      card.hidden = false;
      position(el);
    },

    hide() {
      card.hidden = true;
      target = null;
    },

    reposition() {
      if (!card.hidden && target?.isConnected) position(target);
    },

    get visible() {
      return !card.hidden;
    },

    get target() {
      return target;
    },
  };

  function position(el) {
    const rect = el.getBoundingClientRect();
    const height = card.offsetHeight || 260;
    const width = card.offsetWidth || 320;

    const below = rect.bottom + 10;
    const top = below + height < window.innerHeight ? below : Math.max(10, rect.top - height - 10);

    card.style.top = `${top}px`;
    card.style.left = `${Math.max(70, Math.min(rect.left, window.innerWidth - width - 12))}px`;
  }
}
