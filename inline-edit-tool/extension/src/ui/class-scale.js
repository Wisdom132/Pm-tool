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
