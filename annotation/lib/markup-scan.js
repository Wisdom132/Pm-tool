'use strict';

/**
 * Scanning HTML-shaped markup.
 *
 * Shared by the Svelte and Angular plugins, which both walk a template as
 * text rather than through a framework parser, and which both feed the same
 * HTML codemod.
 *
 * They are together because keeping them apart is what let them drift:
 * Svelte's close-tag scan counted depth and Angular's took the first match,
 * so `<div><div>Copy</div></div>` convinced Angular the *outer* div held
 * editable text. Rewriting it would have deleted the inner one. Nothing
 * compared the two implementations, so nothing noticed.
 */

/** Tags whose text is never page copy. */
const NEVER_COPY = [
  'script', 'style', 'template', 'head', 'html', 'body', 'title',
  'svg', 'path', 'circle', 'rect', 'g', 'defs', 'use', 'symbol',
];

/** 1-based line at an offset. */
function lineAt(source, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

/**
 * 0-based column at an offset.
 *
 * Zero-based because these templates are edited by the HTML codemod, which
 * compares against `element-range.js`. Vue's is 1-based and right for Vue:
 * it comes from @vue/compiler-dom, and its codemod compares against that
 * same parser. Nothing compares a column across frameworks.
 */
function columnAt(source, offset) {
  const before = source.lastIndexOf('\n', offset - 1);
  return offset - before - 1;
}

/**
 * Index just past the '>' that closes the opening tag at `start`.
 * Quoted attribute values are skipped so a '>' inside one is not mistaken
 * for the end of the tag.
 */
function findOpenTagEnd(source, start) {
  let i = start + 1;
  let quote = '';

  while (i < source.length) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i + 1;
    }
    i++;
  }
  return source.length;
}

/**
 * Index of the '<' of the tag that closes the element opened before
 * `openTagEnd`, or null.
 *
 * Depth-aware: "first closing tag wins" stops at a *nested* element of the
 * same name, which then reports the wrong inner content — and an element
 * judged to hold only text when it actually holds a child is an element the
 * codemod will happily overwrite, child and all.
 */
function findCloseTag(source, tag, openTagEnd) {
  const scanner = new RegExp(`<(/?)(${tag})(?=[\\s/>])`, 'gi');
  scanner.lastIndex = openTagEnd;

  let depth = 1;
  let match;

  while ((match = scanner.exec(source)) !== null) {
    const isClosing = match[1] === '/';

    if (isClosing) {
      depth--;
      if (depth === 0) return match.index;
    } else {
      // A self-closing sibling never needs a matching close.
      const end = findOpenTagEnd(source, match.index);
      if (!source.slice(match.index, end).trimEnd().endsWith('/>')) depth++;
    }
  }

  return null;
}

/** Any tag name, so the contents decide what is editable rather than a list. */
const TAG_RE = () => /<([a-zA-Z][\w-]*)(?=[\s/>])/g;

module.exports = { NEVER_COPY, TAG_RE, lineAt, columnAt, findOpenTagEnd, findCloseTag };
