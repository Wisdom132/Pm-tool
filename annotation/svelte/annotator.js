'use strict';

/**
 * Annotation for Svelte components.
 *
 * A .svelte file is markup at the top level with <script> and <style> blocks
 * beside it, so offsets in the file are offsets in the markup — no template
 * wrapper to correct for, unlike Vue.
 *
 * This scans rather than using svelte/compiler. The compiler's AST changed
 * shape between Svelte 4 (`html`, `Element`) and 5 (`fragment`,
 * `RegularElement`), and a plugin that silently stops annotating on a major
 * upgrade is worse than one that never depended on the version at all. It
 * also keeps the package free of another multi-megabyte peer dependency.
 */

const TEXT_TAGS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'span', 'a', 'button', 'label',
  'li', 'td', 'th',
  'strong', 'em', 'small', 'b', 'i',
];

const TAG_RE = new RegExp(`<(${TEXT_TAGS.join('|')})(?=[\\s/>])`, 'gi');

/**
 * Blank out <script> and <style> bodies, keeping every offset and line.
 *
 * Their contents are JavaScript and CSS. A `<p>` in a string literal or a
 * `p { }` selector is not markup, and annotating it would put attributes in
 * the middle of code.
 */
function maskBlocks(source) {
  return source.replace(
    /(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi,
    (all, open, name, body, close) =>
      open + body.replace(/[^\n]/g, ' ') + close
  );
}

/** 1-based line number at an offset. */
function lineAt(source, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

/** 0-based column at an offset. */
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
 * Where the element opened at `openTagEnd` closes.
 *
 * Depth-aware: a `<span>` inside a `<span>` must not end the outer one. The
 * "first closing tag wins" shortcut gets that wrong, and gets it wrong
 * silently, by annotating a range that stops in the middle of the element.
 *
 * @returns {number|null} offset of the matching '</tag'
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

/**
 * Annotate every text-bearing element in a Svelte component.
 *
 * @param {string} source   the .svelte file
 * @param {string} filePath repository-relative, for data-edit-file
 * @returns {string} the annotated source
 */
function annotateSource(source, filePath) {
  const masked = maskBlocks(source);
  const mutations = [];

  TAG_RE.lastIndex = 0;
  let match;

  while ((match = TAG_RE.exec(masked)) !== null) {
    const start = match.index;
    const tag = match[1].toLowerCase();

    const openTagEnd = findOpenTagEnd(masked, start);
    const openTag = masked.slice(start, openTagEnd);

    if (openTag.trimEnd().endsWith('/>')) continue;
    // Idempotent: re-running the plugin must not stack attributes.
    if (openTag.includes('data-edit-file')) continue;

    const closeAt = findCloseTag(masked, tag, openTagEnd);
    if (closeAt === null) continue;

    const inner = source.slice(openTagEnd, closeAt);

    // Child elements mean the text is not this element's to rewrite, and
    // `{count}` is a value the component computes — neither is editable
    // copy, so neither earns an annotation.
    if (/[<>]/.test(inner)) continue;
    if (/\{/.test(inner)) continue;
    if (!inner.trim()) continue;

    mutations.push({
      offset: start + 1 + tag.length,
      text:
        ` data-edit-file="${filePath}"` +
        ` data-edit-line="${lineAt(masked, start)}"` +
        ` data-edit-col="${columnAt(masked, start)}"` +
        ` data-editable="true"` +
        ` data-edit-framework="svelte"`,
    });
  }

  if (mutations.length === 0) return source;

  // Applied last-first, so an earlier insertion cannot shift a later offset.
  mutations.sort((a, b) => b.offset - a.offset);

  let result = source;
  for (const { offset, text } of mutations) {
    result = result.slice(0, offset) + text + result.slice(offset);
  }
  return result;
}

module.exports = {
  annotateSource,
  maskBlocks,
  findCloseTag,
  findOpenTagEnd,
  lineAt,
  columnAt,
  TEXT_TAGS,
};
