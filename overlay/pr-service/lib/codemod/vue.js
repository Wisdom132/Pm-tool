/**
 * Vue SFC codemod.
 *
 * Only the <template> block is touched. Offsets from the template AST are
 * relative to the template's content, so they are shifted by the block's
 * start offset before being applied to the whole file.
 */

import MagicString from 'magic-string';
import { chooseCandidate, describeFailure } from './locate.js';

// Mirrors @vue/compiler-core NodeTypes.
const ELEMENT = 1;
const TEXT = 2;

function collectTextNodes(root, offset) {
  const found = [];

  (function walk(node) {
    if (!node) return;

    if (node.type === ELEMENT) {
      const textChildren = (node.children || []).filter(
        (c) => c.type === TEXT && c.content.trim().length > 0
      );
      const meaningful = (node.children || []).filter(
        (c) => !(c.type === TEXT && c.content.trim().length === 0)
      );

      if (textChildren.length > 0 && meaningful.length === textChildren.length) {
        const first = textChildren[0];
        const last = textChildren[textChildren.length - 1];
        found.push({
          line: node.loc?.start.line,
          column: node.loc?.start.column,
          text: textChildren.map((c) => c.content).join('').replace(/\s+/g, ' ').trim(),
          node: {
            start: offset + first.loc.start.offset,
            end: offset + last.loc.end.offset,
          },
        });
      }
    }

    for (const child of node.children || []) walk(child);
  })(root);

  return found;
}

export function applyVueEdits(source, filePath, edits) {
  // Lazily required so a deployment that never sees a .vue file does not pay
  // for the compiler at import time.
  const { parse: parseSfc } = require('@vue/compiler-sfc');
  const { parse: parseDom } = require('@vue/compiler-dom');

  const { descriptor, errors } = parseSfc(source, { filename: filePath });
  if (errors?.length) {
    throw new Error(`Could not parse ${filePath}: ${errors[0].message}`);
  }
  if (!descriptor.template) {
    throw new Error(`${filePath} has no <template> block`);
  }

  const templateOffset = descriptor.template.loc.start.offset;
  const ast = parseDom(descriptor.template.content, { parseMode: 'base' });

  const candidates = collectTextNodes(ast, templateOffset);
  const s = new MagicString(source);

  const applied = [];
  const failed = [];
  const usedRanges = [];

  for (const edit of edits) {
    // Template AST lines are relative to the template block, so shift the
    // reported line to match before ranking candidates.
    const chosen = chooseCandidate(candidates, {
      ...edit,
      sourceLine: edit.sourceLine,
    });

    if (!chosen) {
      failed.push({ edit, reason: describeFailure(candidates, edit) });
      continue;
    }

    const { start, end } = chosen.node;
    if (usedRanges.some((r) => start < r.end && end > r.start)) {
      failed.push({ edit, reason: `Two edits resolved to the same text in ${filePath}.` });
      continue;
    }

    const raw = source.slice(start, end);
    const leading = raw.match(/^\s*/)[0];
    const trailing = raw.match(/\s*$/)[0];

    s.overwrite(start, end, `${leading}${edit.newText}${trailing}`);
    usedRanges.push({ start, end });
    applied.push({ ...edit, _match: chosen.match });
  }

  return { content: s.toString(), applied, failed };
}
