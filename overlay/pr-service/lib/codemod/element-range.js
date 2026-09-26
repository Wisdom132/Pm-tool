/**
 * Depth-aware element scanning for HTML and Angular templates.
 *
 * The previous approach took the first `</tag>` after the opening tag, so
 * `<span>a <span>b</span></span>` matched the inner close and reported the
 * wrong range. Nesting has to be counted.
 */

/** Elements with no closing tag. */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * End of an opening tag, skipping `>` inside quoted attribute values.
 * @returns index just past the `>`
 */
export function findOpenTagEnd(source, startIdx) {
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

function isSelfClosing(source, startIdx, openEnd) {
  return source.slice(startIdx, openEnd).trimEnd().endsWith('/>');
}

/**
 * The full extent of the element beginning at `startIdx`.
 *
 * @param {string} source
 * @param {number} startIdx index of the element's `<`
 * @returns {{
 *   tag: string, start: number, end: number,
 *   innerStart: number, innerEnd: number, selfClosing: boolean
 * } | null}
 */
export function findElementRange(source, startIdx) {
  const match = /^<([a-zA-Z][\w-]*)/.exec(source.slice(startIdx));
  if (!match) return null;

  const tag = match[1];
  const openEnd = findOpenTagEnd(source, startIdx);

  if (isSelfClosing(source, startIdx, openEnd) || VOID_TAGS.has(tag.toLowerCase())) {
    return {
      tag,
      start: startIdx,
      end: openEnd,
      innerStart: openEnd,
      innerEnd: openEnd,
      selfClosing: true,
    };
  }

  // Count nested opens of the same tag so the matching close is found.
  const scanner = new RegExp(`<(/?)${tag}(?=[\\s/>])`, 'gi');
  scanner.lastIndex = openEnd;

  let depth = 1;
  let found;

  while ((found = scanner.exec(source)) !== null) {
    if (found[1] === '/') {
      depth--;
      if (depth === 0) {
        const closeEnd = source.indexOf('>', found.index);
        return {
          tag,
          start: startIdx,
          end: closeEnd === -1 ? source.length : closeEnd + 1,
          innerStart: openEnd,
          innerEnd: found.index,
          selfClosing: false,
        };
      }
      continue;
    }

    // A nested self-closing tag opens nothing.
    const nestedEnd = findOpenTagEnd(source, found.index);
    if (!isSelfClosing(source, found.index, nestedEnd)) depth++;
    scanner.lastIndex = nestedEnd;
  }

  return null; // unbalanced markup
}

/** Every element of the given tags, with depth-correct ranges. */
export function findElements(source, tags) {
  const wanted = new Set(tags.map((t) => t.toLowerCase()));
  const found = [];
  const openTag = /<([a-zA-Z][\w-]*)(?=[\s/>])/g;
  let match;

  while ((match = openTag.exec(source)) !== null) {
    if (!wanted.has(match[1].toLowerCase())) continue;

    const range = findElementRange(source, match.index);
    if (!range) continue;

    found.push(range);
    // Keep scanning inside, so nested matches are still reported.
  }

  return found;
}

/** 1-based line number of an offset. */
export function lineAt(source, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (source[i] === '\n') line++;
  return line;
}

/** 0-based column of an offset. */
export function columnAt(source, offset) {
  return offset - source.lastIndexOf('\n', offset - 1) - 1;
}

/**
 * The element's siblings of any tag, within its parent.
 *
 * Used to work out where a move should land. Derived by scanning the parent's
 * inner range rather than building a tree — the codemod only ever needs one
 * element's immediate neighbours.
 */
export function findSiblings(source, target) {
  const parent = findParentRange(source, target.start);
  const scope = parent
    ? { start: parent.innerStart, end: parent.innerEnd }
    : { start: 0, end: source.length };

  const siblings = [];
  let cursor = scope.start;

  while (cursor < scope.end) {
    const next = source.indexOf('<', cursor);
    if (next === -1 || next >= scope.end) break;

    // Skip closing tags, comments and declarations.
    if (/[/!?]/.test(source[next + 1] || '')) {
      cursor = next + 1;
      continue;
    }

    const range = findElementRange(source, next);
    if (!range) break;

    siblings.push(range);
    cursor = range.end;
  }

  return siblings;
}

/** The innermost element containing `offset`, if any. */
export function findParentRange(source, offset) {
  let best = null;
  const openTag = /<([a-zA-Z][\w-]*)(?=[\s/>])/g;
  let match;

  while ((match = openTag.exec(source)) !== null) {
    if (match.index >= offset) break;

    const range = findElementRange(source, match.index);
    if (!range || range.selfClosing) continue;

    // Strictly containing, not the element itself.
    if (range.innerStart <= offset && range.innerEnd > offset && range.start !== offset) {
      if (!best || range.start > best.start) best = range;
    }
  }

  return best;
}
