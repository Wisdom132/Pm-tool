'use strict';

/**
 * Shared HTML annotation logic for Angular templates.
 * Works on raw HTML strings; used by both the file-based loader and
 * the inline-template processor.
 */

const HTML_TEXT_TAGS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'span', 'a', 'button', 'label',
  'li', 'td', 'th',
  'strong', 'em', 'small', 'b', 'i',
];

const TAG_RE = new RegExp(
  `<(${HTML_TEXT_TAGS.join('|')})(?=[\\s>])`,
  'gi'
);

/** Count newlines before `offset` to get 1-based line number. */
function lineAt(source, offset) {
  let n = 1;
  for (let i = 0; i < offset; i++) {
    if (source[i] === '\n') n++;
  }
  return n;
}

/**
 * Find the end of an HTML opening tag starting at `startIdx` (the '<').
 * Returns the index of the character just after '>'.
 * Handles quoted attribute values so '>' inside strings is not mistaken for
 * the end of the tag.
 */
function findOpenTagEnd(source, startIdx) {
  let i = startIdx + 1; // skip '<'
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

/**
 * Annotate all qualifying text-bearing HTML elements in `source`.
 *
 * @param {string} source       - raw HTML (or template) string
 * @param {string} filePath     - absolute path used for data-edit-file
 * @param {string} framework    - 'angular'
 * @param {number} lineOffset   - add to computed line numbers (for inline templates)
 * @returns {string}            - annotated source
 */
function annotateSource(source, filePath, framework, lineOffset = 0) {
  const mutations = [];

  TAG_RE.lastIndex = 0;
  let match;

  while ((match = TAG_RE.exec(source)) !== null) {
    const tagStart = match.index;
    const tagName = match[1].toLowerCase();

    // Find the end of this opening tag
    const openTagEnd = findOpenTagEnd(source, tagStart);
    const openTagContent = source.slice(tagStart, openTagEnd);

    // Skip self-closing
    if (openTagContent.trimEnd().endsWith('/>')) continue;

    // Skip if already annotated (idempotency)
    if (openTagContent.includes('data-edit-file')) continue;

    // Find the content up to the (first) matching close tag
    const rest = source.slice(openTagEnd);
    const closeRe = new RegExp(`</${tagName}\\s*>`, 'i');
    const closeMatch = closeRe.exec(rest);
    if (!closeMatch) continue;

    const innerContent = rest.slice(0, closeMatch.index);

    // Require direct text: strip child tags and check for non-empty text
    const directText = innerContent.replace(/<[^>]*>/g, '').trim();
    if (!directText) continue;

    const line = lineAt(source, tagStart) + lineOffset;

    // Insert attributes right after '<tagname'
    mutations.push({
      offset: tagStart + 1 + tagName.length,
      text:
        ` data-edit-file="${filePath}"` +
        ` data-edit-line="${line}"` +
        ` data-editable="true"` +
        ` data-edit-framework="${framework}"`,
    });
  }

  if (mutations.length === 0) return source;

  // Apply in reverse order to preserve earlier offsets
  mutations.sort((a, b) => b.offset - a.offset);
  let result = source;
  for (const { offset, text } of mutations) {
    result = result.slice(0, offset) + text + result.slice(offset);
  }
  return result;
}

/**
 * Process a TypeScript source file: find inline `template: \`...\`` literals
 * and annotate the HTML inside them.
 */
function annotateInlineTemplates(source, filePath) {
  // Match template: `...` (backtick template literals only — single/double
  // quotes are rare for multi-line templates and skipped for safety)
  return source.replace(
    /(\btemplate\s*:\s*`)([\s\S]*?)(`)/g,
    (fullMatch, prefix, templateContent, suffix, matchOffset) => {
      const templateStartInFile = matchOffset + prefix.length;
      const lineOffset = (source.slice(0, templateStartInFile).match(/\n/g) || []).length;
      const annotated = annotateSource(templateContent, filePath, 'angular', lineOffset);
      return prefix + annotated + suffix;
    }
  );
}

module.exports = { annotateSource, annotateInlineTemplates };
