/**
 * HTML codemod, used for Angular templates and plain .html files.
 *
 * No HTML parser is pulled in: the annotation side already scans templates
 * with a quote-aware tag scanner, and reusing the same shape here keeps the
 * two consistent. Only elements whose content is pure text are considered,
 * which is exactly the set the annotator marks editable.
 */

import MagicString from 'magic-string';
import { chooseCandidate, describeFailure } from './locate.js';

const TEXT_TAGS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'span', 'a', 'button', 'label',
  'li', 'td', 'th',
  'strong', 'em', 'small', 'b', 'i',
];

const OPEN_TAG = new RegExp(`<(${TEXT_TAGS.join('|')})(?=[\\s>])`, 'gi');

function lineAt(source, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (source[i] === '\n') line++;
  return line;
}

function columnAt(source, offset) {
  const lastBreak = source.lastIndexOf('\n', offset - 1);
  return offset - lastBreak - 1;
}

/** End of the opening tag, skipping '>' inside quoted attribute values. */
function findOpenTagEnd(source, startIdx) {
  let i = startIdx + 1;
  let inStr = false;
  let strCh = '';
  while (i < source.length) {
    const ch = source[i];
    if (inStr) {
      if (ch === strCh) inStr = false;
    } else if (ch === '"' || ch === "'") {
      inStr = true;
      strCh = ch;
    } else if (ch === '>') {
      return i + 1;
    }
    i++;
  }
  return source.length;
}

function collectTextNodes(source) {
  const found = [];
  OPEN_TAG.lastIndex = 0;
  let match;

  while ((match = OPEN_TAG.exec(source)) !== null) {
    const tagStart = match.index;
    const tagName = match[1].toLowerCase();

    const openEnd = findOpenTagEnd(source, tagStart);
    if (source.slice(tagStart, openEnd).trimEnd().endsWith('/>')) continue;

    const rest = source.slice(openEnd);
    const close = new RegExp(`</${tagName}\\s*>`, 'i').exec(rest);
    if (!close) continue;

    const inner = rest.slice(0, close.index);
    // Skip anything containing markup or an interpolation: replacing the
    // whole inner range would destroy it.
    if (/[<>]/.test(inner) || /\{\{/.test(inner)) continue;
    if (!inner.trim()) continue;

    found.push({
      line: lineAt(source, tagStart),
      column: columnAt(source, tagStart),
      text: inner.replace(/\s+/g, ' ').trim(),
      node: { start: openEnd, end: openEnd + inner.length },
    });
  }

  return found;
}

export function applyHtmlEdits(source, filePath, edits) {
  const candidates = collectTextNodes(source);
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

export const __test__ = { collectTextNodes };
