/**
 * JSX / TSX codemod.
 *
 * Parses with @babel/parser and rewrites through magic-string, so only the
 * changed characters move. Regenerating from the AST with a printer would
 * reformat the whole file and bury a one-word copy change in hundreds of
 * lines of diff.
 */

import { parse } from '@babel/parser';
import MagicString from 'magic-string';
import { chooseCandidate, describeFailure } from './locate.js';

const PLUGINS = ['jsx', 'classProperties', 'decorators-legacy', 'objectRestSpread'];

function parseSource(source, filePath) {
  const isTs = /\.tsx?$/.test(filePath);
  return parse(source, {
    sourceType: 'module',
    errorRecovery: true,
    plugins: isTs ? [...PLUGINS, 'typescript'] : [...PLUGINS, 'flow'],
  });
}

/**
 * Walk the AST collecting every JSXElement that has direct text.
 *
 * The text reported is the concatenation of its direct JSXText children with
 * whitespace collapsed, which is what the browser renders and therefore what
 * the editor saw.
 */
function collectTextNodes(ast) {
  const found = [];

  walk(ast.program, (node) => {
    if (node.type !== 'JSXElement') return;

    const textChildren = node.children.filter(
      (c) => c.type === 'JSXText' && c.value.trim().length > 0
    );
    if (textChildren.length === 0) return;

    // Only handle elements whose entire content is text. Anything with an
    // interpolation or a nested element is ambiguous to rewrite wholesale.
    const meaningful = node.children.filter(
      (c) => !(c.type === 'JSXText' && c.value.trim().length === 0)
    );
    if (meaningful.length !== textChildren.length) return;

    const text = textChildren.map((c) => c.value).join('').replace(/\s+/g, ' ').trim();

    found.push({
      line: node.openingElement.loc?.start.line,
      column: node.openingElement.loc?.start.column,
      text,
      node: { first: textChildren[0], all: textChildren },
    });
  });

  return found;
}

/** Minimal AST walk — babel's traverse is a heavier dependency than needed. */
function walk(node, visit, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);

  if (typeof node.type === 'string') visit(node);

  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit, seen);
    } else if (value && typeof value === 'object') {
      walk(value, visit, seen);
    }
  }
}

/**
 * Apply every edit for one file in a single pass.
 *
 * @param {string} source
 * @param {string} filePath
 * @param {Array<object>} edits
 * @returns {{content: string, applied: object[], failed: Array<{edit: object, reason: string}>}}
 */
export function applyJsxEdits(source, filePath, edits) {
  const ast = parseSource(source, filePath);
  const candidates = collectTextNodes(ast);
  const s = new MagicString(source);

  const applied = [];
  const failed = [];
  const usedRanges = [];

  for (const edit of edits) {
    const chosen = chooseCandidate(candidates, edit);
    if (!chosen) {
      failed.push({ edit, reason: describeFailure(candidates, edit) });
      continue;
    }

    const { first, all } = chosen.node;
    const start = first.start;
    const end = all[all.length - 1].end;

    // Two edits resolving to the same node means the caller sent duplicates;
    // overwriting twice would throw inside magic-string.
    if (usedRanges.some((r) => start < r.end && end > r.start)) {
      failed.push({
        edit,
        reason: `Two edits resolved to the same text in ${filePath}.`,
      });
      continue;
    }

    // Preserve the original surrounding whitespace so indentation and the
    // newline style of the JSX block are untouched.
    const raw = source.slice(start, end);
    const leading = raw.match(/^\s*/)[0];
    const trailing = raw.match(/\s*$/)[0];

    s.overwrite(start, end, `${leading}${edit.newText}${trailing}`);
    usedRanges.push({ start, end });
    applied.push({ ...edit, _match: chosen.match });
  }

  return { content: s.toString(), applied, failed };
}

export const __test__ = { collectTextNodes, parseSource };
