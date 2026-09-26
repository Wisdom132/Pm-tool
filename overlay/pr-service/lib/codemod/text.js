/**
 * Literal text fallback.
 *
 * Used for file types with no parser, and when a parser fails. Unlike the
 * original implementation this reports failures per edit instead of throwing,
 * and applies every edit in one pass.
 */

import MagicString from 'magic-string';

/** Lines away from the reported one that are still searched. */
const WINDOW = 2;

export function applyTextEdits(source, filePath, edits) {
  const lines = source.split('\n');

  // Byte offset at which each line starts.
  const lineStarts = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }

  const s = new MagicString(source);
  const applied = [];
  const failed = [];
  const usedRanges = [];

  for (const edit of edits) {
    const target = Number.isFinite(edit.sourceLine) ? edit.sourceLine - 1 : null;

    // Search outwards from the reported line, then the whole file. The line
    // can point past the end when the file has shrunk since the build, so
    // every index is bounds-checked before use.
    const order = [];
    const inRange = (i) => i >= 0 && i < lines.length;
    if (target !== null) {
      for (let d = 0; d <= WINDOW; d++) {
        if (inRange(target - d)) order.push(target - d);
        if (d > 0 && inRange(target + d)) order.push(target + d);
      }
    }
    for (let i = 0; i < lines.length; i++) if (!order.includes(i)) order.push(i);

    let placed = null;
    for (const i of order) {
      const col = lines[i].indexOf(edit.originalText);
      if (col === -1) continue;
      const start = lineStarts[i] + col;
      const end = start + edit.originalText.length;
      if (usedRanges.some((r) => start < r.end && end > r.start)) continue;
      placed = { start, end };
      break;
    }

    if (!placed) {
      failed.push({
        edit,
        reason: `Could not find "${edit.originalText}" in ${filePath}.`,
      });
      continue;
    }

    s.overwrite(placed.start, placed.end, edit.newText);
    usedRanges.push(placed);
    applied.push({ ...edit, _match: 'text' });
  }

  return { content: s.toString(), applied, failed };
}
