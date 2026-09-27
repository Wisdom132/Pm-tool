/**
 * Vue SFC codemod.
 *
 * Only the <template> block is touched. Offsets from the template AST are
 * relative to the template's content, so they are shifted by the block's
 * start offset before being applied to the whole file.
 */

import MagicString from 'magic-string';
// Static imports: this module is ESM, and the CommonJS require() that used
// to be here threw "require is not defined" on every call. The failure was
// swallowed by the dispatcher's fallback, so Vue files were silently patched
// by blind string replacement — including inside <script>.
import { parse as parseSfc } from '@vue/compiler-sfc';
import { parse as parseDom } from '@vue/compiler-dom';
import { chooseCandidate, describeFailure } from './locate.js';

// Mirrors @vue/compiler-core NodeTypes.
const ELEMENT = 1;
const TEXT = 2;

function collectTextNodes(root, offset, lineOffset) {
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
          // Shifted to a file line, so a Vue edit means the same thing as a
          // React or Angular one.
          line: (node.loc?.start.line ?? 1) + lineOffset,
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

/** Number of whole lines before the template block's content begins. */
function linesBefore(source, offset) {
  let lines = 0;
  for (let i = 0; i < offset; i++) if (source[i] === '\n') lines++;
  return lines;
}

export function applyVueEdits(source, filePath, edits) {
  const { descriptor, errors } = parseSfc(source, { filename: filePath });
  if (errors?.length) {
    throw new Error(`Could not parse ${filePath}: ${errors[0].message}`);
  }
  if (!descriptor.template) {
    throw new Error(`${filePath} has no <template> block`);
  }

  const templateOffset = descriptor.template.loc.start.offset;
  const ast = parseDom(descriptor.template.content, { parseMode: 'base' });

  const candidates = collectTextNodes(
    ast,
    templateOffset,
    linesBefore(source, templateOffset)
  );
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
