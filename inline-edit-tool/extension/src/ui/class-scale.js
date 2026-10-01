"use strict";

// ============================================================
//  Design changes as class changes
//
//  VisBug nudges padding by writing an inline style. That is
//  the right call for a sandbox and the wrong one here: an
//  inline style evaporates on refresh, and if it did survive
//  it would land in a pull request as markup nobody on the
//  team writes by hand.
//
//  A utility codebase already has a word for "one step more
//  padding" — it is `p-5` instead of `p-4`. Stepping the class
//  goes through the class editor that already works, which
//  means every design nudge becomes a reviewable diff for
//  free.
//
//  Where there is no utility class to step, we fall back to an
//  inline style. Honest, and still committable, but second
//  choice — it is markup the codebase does not otherwise use.
// ============================================================

/**
 * Tailwind's spacing scale, in order.
 *
 * Deliberately the literal list rather than arithmetic: the scale is not
 * linear. It steps by 0.5 up to 4, by 1 to 12, then by 2, 4 and 8. Computing
 * "the next size" with multiplication produces classes that do not exist,
 * and a class that does not exist is a silent no-op on the page and a
 * nonsense diff in the pull request.
 */
export const SPACING_SCALE = [
  "0", "px", "0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "5", "6", "7",
  "8", "9", "10", "11", "12", "14", "16", "20", "24", "28", "32", "36", "40",
  "44", "48", "52", "56", "60", "64", "72", "80", "96",
];

/** Font sizes, smallest to largest. */
export const FONT_SCALE = [
  "xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl",
  "8xl", "9xl",
];

/** Font weights. */
export const WEIGHT_SCALE = [
  "thin", "extralight", "light", "normal", "medium", "semibold", "bold",
  "extrabold", "black",
];

/** Border radius. */
export const RADIUS_SCALE = ["none", "sm", "", "md", "lg", "xl", "2xl", "3xl", "full"];

/** Shadows, flat to deep. */
export const SHADOW_SCALE = ["none", "sm", "", "md", "lg", "xl", "2xl"];

/** Opacity, in the steps Tailwind actually ships. */
export const OPACITY_SCALE = [
  "0", "5", "10", "20", "25", "30", "40", "50", "60", "70", "75", "80", "90",
  "95", "100",
];

/** Z-index, in the steps Tailwind ships. */
export const Z_SCALE = ["0", "10", "20", "30", "40", "50"];

/**
 * Mutually exclusive bare class names.
 *
 * Positioning is not a scale — `absolute` is not "more" than `relative` —
 * so these cycle rather than step, and setting one removes the others.
 * Modelled separately because a stepper that pretended they were ordered
 * would offer "one more absolute", which means nothing.
 */
export const MODES = {
  position: ["static", "relative", "absolute", "fixed", "sticky"],

  // Enough display values to turn something into a flex or grid container,
  // which is what the alignment rows below need. Deliberately *not* the whole
  // list: `hidden` belongs to a cycle nobody wants to land on by accident,
  // since the element the panel is pointed at would vanish mid-edit.
  display: ["block", "inline-block", "flex", "inline-flex", "grid"],

  // Flex alignment, from VisBug's flex tool. There it is four hotkey pairs
  // writing inline styles; here each axis is a cycle of the classes a
  // utility codebase already uses, so the change arrives as a diff.
  //
  // The values are the full class names rather than CSS keywords, which is
  // what lets `findMode` and `stepMode` handle these unchanged — a mode is
  // identified by the class being present, and `justify-center` is as bare a
  // class name as `relative` is.
  flexDirection: ["flex-row", "flex-col", "flex-row-reverse", "flex-col-reverse"],

  // Ordered the way the content moves, not the way the CSS spec lists them:
  // packed left, centred, packed right, then the three that spread it out.
  justifyContent: [
    "justify-start",
    "justify-center",
    "justify-end",
    "justify-between",
    "justify-around",
    "justify-evenly",
  ],
  alignItems: ["items-start", "items-center", "items-end", "items-stretch", "items-baseline"],
  flexWrap: ["flex-nowrap", "flex-wrap", "flex-wrap-reverse"],
};

/**
 * Is this element laid out by flexbox or grid?
 *
 * Read from the computed display rather than from a class, because an element
 * is very often a flex container by way of the page's own stylesheet with no
 * utility class on it at all. Deciding from classes would tell somebody their
 * `justify-*` row was unavailable while looking straight at a flex row.
 *
 * VisBug answers this question by not asking it: its flex tool runs
 * `el.style.display = 'flex'` on whatever is selected. That is right for a
 * scratchpad and wrong here — it would put a `display: flex` nobody typed
 * into the pull request, as a side effect of pressing an arrow key.
 */
export function isFlexContainer(el, win = window) {
  if (!el) return false;
  const display = win.getComputedStyle(el).display || "";
  // `inline-flex` and `inline-grid` count; `flow-root` and `block` do not.
  return /\b(flex|grid)\b/.test(display);
}

/**
 * The properties a design tool can step, and how each maps to a class.
 *
 * `prefixes` are ordered most-specific first, because `pt-4` and `p-4` can
 * both be present and the narrower one wins on the page — so it is the one
 * to step.
 */
export const PROPERTIES = {
  padding: { prefixes: ["pt", "pr", "pb", "pl", "px", "py", "p"], scale: SPACING_SCALE, css: "padding" },
  margin: { prefixes: ["mt", "mr", "mb", "ml", "mx", "my", "m"], scale: SPACING_SCALE, css: "margin", negatable: true },
  gap: { prefixes: ["gap-x", "gap-y", "gap"], scale: SPACING_SCALE, css: "gap" },
  fontSize: { prefixes: ["text"], scale: FONT_SCALE, css: "font-size" },
  fontWeight: { prefixes: ["font"], scale: WEIGHT_SCALE, css: "font-weight" },
  radius: { prefixes: ["rounded"], scale: RADIUS_SCALE, css: "border-radius" },
  shadow: { prefixes: ["shadow"], scale: SHADOW_SCALE, css: "box-shadow" },
  opacity: { prefixes: ["opacity"], scale: OPACITY_SCALE, css: "opacity" },

  // Positioning offsets. Negatable, because pulling something up and left
  // out of its box is most of what positioning is for.
  top: { prefixes: ["top"], scale: SPACING_SCALE, css: "top", negatable: true },
  right: { prefixes: ["right"], scale: SPACING_SCALE, css: "right", negatable: true },
  bottom: { prefixes: ["bottom"], scale: SPACING_SCALE, css: "bottom", negatable: true },
  left: { prefixes: ["left"], scale: SPACING_SCALE, css: "left", negatable: true },
  inset: { prefixes: ["inset-x", "inset-y", "inset"], scale: SPACING_SCALE, css: "inset", negatable: true },
  zIndex: { prefixes: ["z"], scale: Z_SCALE, css: "z-index" },
};

/**
 * Find the class on this element that controls `property`.
 *
 * @returns {{className: string, prefix: string, value: string, negative: boolean}|null}
 */
export function findUtilityClass(classList, property) {
  const spec = PROPERTIES[property];
  if (!spec) return null;

  const names = Array.from(classList);

  for (const prefix of spec.prefixes) {
    for (const name of names) {
      // A leading `-` is Tailwind's negative margin. Variants like
      // `md:p-4` or `hover:p-4` are deliberately *not* matched: stepping a
      // responsive class from a desktop viewport would change a breakpoint
      // the person cannot currently see.
      if (name.includes(":")) continue;

      const negative = name.startsWith("-");
      const bare = negative ? name.slice(1) : name;

      if (bare === prefix) {
        // A bare `rounded` or `shadow` — the scale's unnamed middle entry.
        if (spec.scale.includes("")) {
          return { className: name, prefix, value: "", negative };
        }
        continue;
      }

      if (!bare.startsWith(`${prefix}-`)) continue;

      const value = bare.slice(prefix.length + 1);
      if (!spec.scale.includes(value)) continue;

      return { className: name, prefix, value, negative };
    }
  }

  return null;
}

/** Build a class name back from its parts. */
function classNameFor(prefix, value, negative) {
  const base = value === "" ? prefix : `${prefix}-${value}`;
  return negative ? `-${base}` : base;
}

/**
 * Step a property up or down by one place on its scale.
 *
 * @param {Iterable<string>} classList  the element's current classes
 * @param {string} property             a key of PROPERTIES
 * @param {number} direction            +1 or -1
 * @param {string} [defaultPrefix]      what to add when nothing is set
 * @returns {{from: string|null, to: string, classes: string[]}|null}
 *          null when the step would run off the end of the scale — better
 *          than silently clamping, so the caller can say "already the
 *          largest" instead of appearing to do nothing
 */
export function stepClass(classList, property, direction, defaultPrefix) {
  const spec = PROPERTIES[property];
  if (!spec) return null;

  const names = Array.from(classList);
  const current = findUtilityClass(names, property);

  // Nothing set: start from the scale's base and take one step, so the
  // first press has a visible effect rather than establishing a value.
  if (!current) {
    const prefix = defaultPrefix || spec.prefixes[spec.prefixes.length - 1];
    const start = spec.scale.indexOf(property === "fontSize" ? "base" : "0");
    const from = start === -1 ? 0 : start;
    const next = from + direction;
    if (next < 0 || next >= spec.scale.length) return null;

    const added = classNameFor(prefix, spec.scale[next], false);
    return { from: null, to: added, classes: [...names, added] };
  }

  const index = spec.scale.indexOf(current.value);
  if (index === -1) return null;

  // A negative margin runs the other way: -m-4 is *further* out than -m-2,
  // so stepping "up" visually means a smaller magnitude.
  const effective = current.negative ? -direction : direction;
  const next = index + effective;

  // Crossing zero flips the sign rather than stopping, which is what makes
  // a margin continuously adjustable through zero.
  if (next < 0) {
    if (!spec.negatable) return null;
    const flipped = classNameFor(current.prefix, spec.scale[1] ?? "px", !current.negative);
    return {
      from: current.className,
      to: flipped,
      classes: names.map((n) => (n === current.className ? flipped : n)),
    };
  }

  if (next >= spec.scale.length) return null;

  const to = classNameFor(current.prefix, spec.scale[next], current.negative);
  return {
    from: current.className,
    to,
    classes: names.map((n) => (n === current.className ? to : n)),
  };
}

/**
 * Does this page look like it uses utility classes?
 *
 * Checked against the page's own classes rather than assumed, because
 * stepping a class on a codebase that does not use them would add markup
 * nobody there writes — a diff a reviewer would reject.
 */
export function usesUtilityClasses(doc = document) {
  // Distinct prefixes, not a raw count. A page that copied one component
  // off the internet has `w-full` and `text-center` and nothing else — two
  // elements, two prefixes. A codebase that genuinely uses utilities
  // reaches for spacing *and* type *and* layout within a few elements.
  // Counting breadth separates those; counting occurrences does not.
  const PREFIXES = [
    "p", "px", "py", "pt", "pb", "pl", "pr",
    "m", "mx", "my", "mt", "mb", "ml", "mr",
    "gap", "text", "font", "rounded", "shadow", "flex", "grid", "w", "h",
  ];

  const seen = new Set();

  for (const el of doc.querySelectorAll("[class]")) {
    for (const name of String(el.className).split(/\s+/)) {
      const bare = name.startsWith("-") ? name.slice(1) : name;
      const dash = bare.indexOf("-");
      if (dash <= 0) continue;

      const prefix = bare.slice(0, dash);
      if (PREFIXES.includes(prefix)) seen.add(prefix);
    }
    // Three different families. One or two is a copied snippet; three is a
    // codebase that reaches for utilities across spacing, type and layout.
    // Scanning the rest of a large page costs more than the answer is worth.
    if (seen.size >= 3) return true;
  }

  return false;
}

/**
 * Which mode class this element currently has, if any.
 *
 * @returns {{className: string, value: string}|null}
 */
export function findMode(classList, property) {
  const modes = MODES[property];
  if (!modes) return null;

  for (const name of Array.from(classList)) {
    if (name.includes(":")) continue;
    if (modes.includes(name)) return { className: name, value: name };
  }
  return null;
}

/**
 * Cycle to the next mode, removing whichever one is set.
 *
 * Wraps, unlike `stepClass`. A scale has ends worth refusing at; a cycle of
 * five positioning modes does not — stopping at `sticky` would just mean
 * pressing the other arrow five times to get back to `static`.
 *
 * @returns {{from: string|null, to: string, classes: string[]}|null}
 */
export function stepMode(classList, property, direction) {
  const modes = MODES[property];
  if (!modes) return null;

  const names = Array.from(classList);
  const current = findMode(names, property);

  const at = current ? modes.indexOf(current.value) : 0;
  const next = (at + direction + modes.length) % modes.length;
  const to = modes[next];

  // Every other mode is removed, not just the one found: a page can have
  // ended up with two through a merge, and leaving one behind would make
  // the class list say something different from what the panel shows.
  const kept = names.filter((n) => !modes.includes(n));

  return {
    from: current?.className ?? null,
    to,
    // `static` is the default, so naming it explicitly is noise in the diff
    // — unless something above it set a position that needs overriding,
    // which is exactly when somebody reaches for it.
    classes: [...kept, to],
  };
}

/**
 * The nearest value on a scale to a pixel distance.
 *
 * What makes a drag committable: the pointer lands on an arbitrary number,
 * and this turns it into the class the codebase would have written. Without
 * it a drag produces `top-[347px]`, which is a real class and a diff nobody
 * wants to review.
 *
 * @param {number} px
 * @param {number} rem  the page's root font size, since the scale is in rem
 * @returns {{value: string, negative: boolean}}
 */
export function nearestSpacing(px, rem = 16) {
  const negative = px < 0;
  const target = Math.abs(px);

  let best = SPACING_SCALE[0];
  let bestGap = Infinity;

  for (const value of SPACING_SCALE) {
    // `px` is Tailwind's literal one-pixel step; everything else is rem.
    const size = value === "px" ? 1 : Number(value) * (rem / 4);
    if (!Number.isFinite(size)) continue;

    const gap = Math.abs(size - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = value;
    }
  }

  return { value: best, negative };
}
