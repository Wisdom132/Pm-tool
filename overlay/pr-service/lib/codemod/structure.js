/**
 * Structural edits: delete, duplicate, move an element.
 *
 * These rewrite whole elements rather than a value inside one, so they are
 * kept apart from the text and attribute paths. Ranges are taken from the
 * AST and applied with magic-string, which keeps the rest of the file — and
 * therefore the diff — untouched.
 *
 * Deliberately conservative: an element is only operated on when its
 * position is unambiguous. Deleting the wrong node is far worse than
 * refusing and saying why.
 */

import { parse } from '@babel/parser';
import MagicString from 'magic-string';
import {
  findElementRange,
  findSiblings,
  lineAt,
  columnAt,
} from './element-range.js';

export const STRUCTURAL_OPS = new Set(['delete', 'duplicate', 'move', 'move-up', 'move-down']);

/**
 * How far to move, as a signed sibling offset.
 *
 * `move-up` / `move-down` are accepted for a single step; `move` carries an
 * explicit `moveBy` so an editor can nudge something several places without
 * queueing several conflicting edits.
 */
export function moveOffset(edit) {
  if (edit.op === 'move-up') return -1;
  if (edit.op === 'move-down') return 1;
  return Number.isInteger(edit.moveBy) ? edit.moveBy : 0;
}

const PLUGINS = ['jsx', 'classProperties', 'decorators-legacy', 'objectRestSpread'];

function parseSource(source, filePath) {
  const isTs = /\.tsx?$/.test(filePath);
  return parse(source, {
    sourceType: 'module',
    errorRecovery: true,
    plugins: isTs ? [...PLUGINS, 'typescript'] : [...PLUGINS, 'flow'],
  });
}

function walk(node, visit, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (typeof node.type === 'string') visit(node);

  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    const value = node[key];
    if (Array.isArray(value)) for (const child of value) walk(child, visit, seen);
    else if (value && typeof value === 'object') walk(value, visit, seen);
  }
}

/** Element children only — JSXText whitespace is structure, not content. */
function elementChildren(node) {
  return (node.children || []).filter((c) => c.type === 'JSXElement');
}

/**
 * Find the element an edit refers to, by source position.
 *
 * Structural ops always come from an annotated element, so line and column
 * are exact. There is no text to fall back on the way there is for a copy
 * change, so an inexact match is refused rather than guessed.
 */
function findElement(ast, { sourceLine, sourceColumn }) {
  let match = null;

  walk(ast.program, (node) => {
    if (node.type !== 'JSXElement') return;
    const loc = node.openingElement.loc?.start;
    if (!loc || loc.line !== sourceLine) return;
    // Prefer an exact column; otherwise the only element on that line.
    if (sourceColumn === undefined || loc.column === sourceColumn) {
      if (!match || loc.column === sourceColumn) match = node;
    }
  });

  return match;
}

/** The whole line(s) an element occupies, including its own indentation. */
function elementRange(source, node) {
  let start = node.start;
  // Reach back over the indentation so a deletion does not leave a blank gap.
  while (start > 0 && (source[start - 1] === ' ' || source[start - 1] === '\t')) start--;

  let end = node.end;
  // And forward over a trailing newline.
  if (source[end] === '\n') end++;

  return { start, end };
}

/**
 * @returns {{content: string, applied: object[], failed: Array<{edit, reason}>}}
 */
export function applyStructuralEdits(source, filePath, edits) {
  const ast = parseSource(source, filePath);
  const s = new MagicString(source);

  const applied = [];
  const failed = [];
  const touched = [];

  for (const edit of edits) {
    const node = findElement(ast, edit);

    if (!node) {
      failed.push({
        edit,
        reason: `Could not find the element at ${filePath}:${edit.sourceLine}. The file has changed since the preview was built.`,
      });
      continue;
    }

    const range = elementRange(source, node);
    if (touched.some((r) => range.start < r.end && range.end > r.start)) {
      failed.push({ edit, reason: `Two structural edits overlap in ${filePath}.` });
      continue;
    }

    const text = source.slice(range.start, range.end);

    if (edit.op === 'delete') {
      s.remove(range.start, range.end);
      touched.push(range);
      applied.push({ ...edit, _match: 'structure' });
      continue;
    }

    if (edit.op === 'duplicate') {
      // Insert a copy directly after, so the new element keeps the
      // original's indentation and surrounding whitespace.
      s.appendLeft(range.end, text.endsWith('\n') ? text : `\n${text}`);
      touched.push(range);
      applied.push({ ...edit, _match: 'structure' });
      continue;
    }

    if (edit.op === 'move' || edit.op === 'move-up' || edit.op === 'move-down') {
      const offset = moveOffset(edit);
      if (offset === 0) {
        failed.push({ edit, reason: 'This element is already where it started.' });
        continue;
      }

      const parent = findParentOf(ast, node);
      const siblings = parent ? elementChildren(parent) : [];
      const index = siblings.indexOf(node);
      const targetIndex = index + offset;

      if (index === -1 || targetIndex < 0 || targetIndex >= siblings.length) {
        failed.push({
          edit,
          reason: `Cannot move this element ${Math.abs(offset)} place(s) ${offset < 0 ? 'up' : 'down'} — it would fall outside its siblings.`,
        });
        continue;
      }

      const other = siblings[targetIndex];
      const otherRange = elementRange(source, other);

      if (touched.some((r) => otherRange.start < r.end && otherRange.end > r.start)) {
        failed.push({ edit, reason: `Two structural edits overlap in ${filePath}.` });
        continue;
      }

      // Swap the two blocks in place.
      s.overwrite(range.start, range.end, source.slice(otherRange.start, otherRange.end));
      s.overwrite(otherRange.start, otherRange.end, text);

      touched.push(range, otherRange);
      applied.push({ ...edit, _match: 'structure' });
      continue;
    }

    failed.push({ edit, reason: `Unknown structural operation "${edit.op}".` });
  }

  return { content: s.toString(), applied, failed };
}

function findParentOf(ast, target) {
  let parent = null;
  walk(ast.program, (node) => {
    if (node.type !== 'JSXElement') return;
    if ((node.children || []).includes(target)) parent = node;
  });
  return parent;
}

// ============================================================
//  HTML / Angular templates
// ============================================================

/**
 * Structural edits for markup, using the same depth-aware scanner the text
 * path uses. Without this the Rearrange tool offered operations that could
 * only ever fail on a Vue or Angular project.
 */
export function applyHtmlStructuralEdits(source, filePath, edits) {
  const s = new MagicString(source);
  const applied = [];
  const failed = [];
  const touched = [];

  for (const edit of edits) {
    const node = findHtmlElement(source, edit);

    if (!node) {
      failed.push({
        edit,
        reason: `Could not find the element at ${filePath}:${edit.sourceLine}. The file has changed since the preview was built.`,
      });
      continue;
    }

    const range = withIndentation(source, node);
    if (touched.some((r) => range.start < r.end && range.end > r.start)) {
      failed.push({ edit, reason: `Two structural edits overlap in ${filePath}.` });
      continue;
    }

    const text = source.slice(range.start, range.end);

    if (edit.op === 'delete') {
      s.remove(range.start, range.end);
      touched.push(range);
      applied.push({ ...edit, _match: 'structure' });
      continue;
    }

    if (edit.op === 'duplicate') {
      s.appendLeft(range.end, text.endsWith('\n') ? text : `\n${text}`);
      touched.push(range);
      applied.push({ ...edit, _match: 'structure' });
      continue;
    }

    const offset = moveOffset(edit);
    if (offset === 0) {
      failed.push({ edit, reason: 'This element is already where it started.' });
      continue;
    }

    const siblings = findSiblings(source, node);
    const index = siblings.findIndex((sib) => sib.start === node.start);
    const targetIndex = index + offset;

    if (index === -1 || targetIndex < 0 || targetIndex >= siblings.length) {
      failed.push({
        edit,
        reason: `Cannot move this element ${Math.abs(offset)} place(s) ${offset < 0 ? 'up' : 'down'} — it would fall outside its siblings.`,
      });
      continue;
    }

    const otherRange = withIndentation(source, siblings[targetIndex]);
    if (touched.some((r) => otherRange.start < r.end && otherRange.end > r.start)) {
      failed.push({ edit, reason: `Two structural edits overlap in ${filePath}.` });
      continue;
    }

    s.overwrite(range.start, range.end, source.slice(otherRange.start, otherRange.end));
    s.overwrite(otherRange.start, otherRange.end, text);

    touched.push(range, otherRange);
    applied.push({ ...edit, _match: 'structure' });
  }

  return { content: s.toString(), applied, failed };
}

/** Locate a markup element by the line the annotation recorded. */
function findHtmlElement(source, edit) {
  const openTag = /<([a-zA-Z][\w-]*)(?=[\s/>])/g;
  let match;
  let fallback = null;

  while ((match = openTag.exec(source)) !== null) {
    if (lineAt(source, match.index) !== edit.sourceLine) continue;

    const range = findElementRange(source, match.index);
    if (!range) continue;

    if (edit.sourceColumn === undefined) return range;
    if (columnAt(source, match.index) === edit.sourceColumn) return range;
    if (!fallback) fallback = range;
  }

  return fallback;
}

/** Widen a range to own its indentation and trailing newline. */
function withIndentation(source, node) {
  let start = node.start;
  while (start > 0 && (source[start - 1] === ' ' || source[start - 1] === '\t')) start--;

  let end = node.end;
  if (source[end] === '\n') end++;

  return { start, end };
}
