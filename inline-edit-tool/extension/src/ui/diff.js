"use strict";

// ============================================================
//  Word-level diff
//
//  A before/after pair of whole sentences makes the reader find
//  the change themselves. Marking the words that actually moved
//  turns "did they fix the typo or rewrite the line?" into
//  something answerable at a glance.
//
//  Classic LCS over word tokens: copy is short, so an O(n·m)
//  table costs nothing and gives a minimal, stable diff.
// ============================================================

/** Split into words while keeping the whitespace, so output can be rebuilt exactly. */
export function tokenize(text) {
  return String(text).match(/\s+|[^\s]+/g) || [];
}

/**
 * @param {string} before
 * @param {string} after
 * @returns {Array<{type: 'same'|'removed'|'added', value: string}>}
 */
export function diffWords(before, after) {
  const a = tokenize(before);
  const b = tokenize(after);

  // lengths[i][j] = LCS length of a[i..] and b[j..]
  const lengths = Array.from({ length: a.length + 1 }, () =>
    new Uint32Array(b.length + 1)
  );

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] =
        a[i] === b[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const parts = [];
  const push = (type, value) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.value += value;
    else parts.push({ type, value });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      push("removed", a[i++]);
    } else {
      push("added", b[j++]);
    }
  }
  while (i < a.length) push("removed", a[i++]);
  while (j < b.length) push("added", b[j++]);

  return parts;
}

/** Largest middle section we will build an LCS table for. */
const LINE_DIFF_LIMIT = 1200;

/**
 * How many lines a whole-file edit added and removed.
 *
 * A file edited in the source panel has no meaningful before/after text to
 * show in the review table, so the count is what tells the reader whether
 * they changed a word or rewrote the file.
 *
 * Identical head and tail lines are trimmed first: an edit is almost always
 * local, so this usually leaves a handful of lines to compare properly, and
 * keeps the table from being built over a whole file.
 *
 * @returns {{added: number, removed: number}}
 */
export function countChangedLines(before, after) {
  // "".split("\n") is [""], so an emptied file would otherwise be reported as
  // having gained a line while losing the rest.
  const lines = (text) => (text === "" ? [] : String(text).split("\n"));

  const a = lines(before);
  const b = lines(after);

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;

  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }

  const left = a.slice(head, a.length - tail);
  const right = b.slice(head, b.length - tail);

  if (left.length === 0 || right.length === 0) {
    return { added: right.length, removed: left.length };
  }

  // Too much left to compare line by line: report the block wholesale rather
  // than spend a quadratic table on it.
  if (left.length > LINE_DIFF_LIMIT || right.length > LINE_DIFF_LIMIT) {
    return { added: right.length, removed: left.length };
  }

  const lengths = Array.from({ length: left.length + 1 }, () =>
    new Uint32Array(right.length + 1)
  );

  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      lengths[i][j] =
        left[i] === right[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const common = lengths[0][0];
  return { added: right.length - common, removed: left.length - common };
}

/**
 * Render a diff into an element.
 *
 * @param {'removed'|'added'} side  which side of the pair this is; the
 *        opposite side's parts are omitted so each column reads as prose
 */
export function renderDiff(container, parts, side) {
  container.textContent = "";

  for (const part of parts) {
    if (part.type !== "same" && part.type !== side) continue;

    if (part.type === "same") {
      container.appendChild(document.createTextNode(part.value));
      continue;
    }

    const mark = document.createElement("mark");
    mark.className = `__iet-diff-${side}`;
    mark.textContent = part.value;
    container.appendChild(mark);
  }
}
