'use strict';

const {
  NEVER_COPY,
  TAG_RE: tagScanner,
  lineAt,
  columnAt,
  findOpenTagEnd: findOpenEnd,
  findCloseTag,
} = require('../lib/markup-scan.js');
const { translationKey } = require('../lib/i18n-key.js');

/**
 * Shared HTML annotation logic for Angular templates.
 * Works on raw HTML strings; used by both the file-based loader and
 * the inline-template processor.
 */





const findOpenTagEnd = findOpenEnd;

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

  const TAG_RE = tagScanner();
  let match;

  // Elements not nested inside another element in this template. Tags come
  // in document order, so anything past the previous root's close is a root.
  let rootEnd = -1;

  while ((match = TAG_RE.exec(source)) !== null) {
    const tagStart = match.index;
    const tagName = match[1].toLowerCase();
    if (NEVER_COPY.includes(tagName)) continue;
    const isRoot = tagStart >= rootEnd;

    // Find the end of this opening tag
    const openTagEnd = findOpenTagEnd(source, tagStart);
    const openTagContent = source.slice(tagStart, openTagEnd);

    const selfClosing = openTagContent.trimEnd().endsWith('/>');

    // Find the content up to the matching close tag
    // Depth-aware. "First closing tag wins" stopped at a *nested* element
    // of the same name, so `<div><div>Copy</div></div>` reported the outer
    // div as holding only text — and the codemod would then overwrite it,
    // inner div and all.
    const closeAt = selfClosing ? openTagEnd : findCloseTag(source, tagName, openTagEnd);

    // Advance the root span *before* any skip. Doing it after meant that on
    // a second pass the already-annotated root was skipped, `rootEnd` stayed
    // behind, and a nested child was mistaken for a root — annotated again,
    // with a column measured into the already-annotated string. Build tools
    // do run a transform more than once.
    if (isRoot && closeAt !== null) rootEnd = closeAt;

    if (selfClosing) continue;
    // Skip if already annotated (idempotency)
    if (openTagContent.includes('data-edit-file')) continue;
    if (closeAt === null) continue;

    const innerContent = source.slice(openTagEnd, closeAt);

    // An Angular template goes through the *HTML* codemod, which replaces
    // an element's whole inner range. So an element is editable only when
    // that range is nothing but literal text:
    //
    //   a child element — rewriting `<p>Read our <a>guide</a></p>` would
    //   delete the link. This check used to strip child tags and keep
    //   their text, so the <p> counted the anchor's copy as its own and
    //   was offered for editing.
    //
    //   an interpolation — rewriting `<p>{{ count }} deploys</p>` would
    //   write the binding away.
    //
    // Svelte, which feeds the same codemod, has always refused both.
    const hasChildElement = /[<>]/.test(innerContent);
    const interpolated = /\{\{/.test(innerContent);
    const literal = !hasChildElement && !interpolated && Boolean(innerContent.trim());

    // `{{ 'hero.title' | translate }}` is copy in a locale file. The pipe is
    // the dominant Angular idiom and reads the other way round from a call,
    // so the key comes first. A lone interpolation only.
    const lone = hasChildElement ? null : /^\s*\{\{([\s\S]*)\}\}\s*$/.exec(innerContent);
    const i18nKey = literal || !lone ? null : translationKey(lone[1]);

    const editable = literal || Boolean(i18nKey);

    // A root still earns provenance even with no text of its own: without
    // it, an image or an icon has no annotated ancestor, and Inspect and
    // Comment can name no file for it.
    if (!editable && !isRoot) continue;

    const line = lineAt(source, tagStart) + lineOffset;
    const col = columnAt(source, tagStart);

    // Insert attributes right after '<tagname'
    mutations.push({
      offset: tagStart + 1 + tagName.length,
      text:
        ` data-edit-file="${filePath}"` +
        ` data-edit-line="${line}"` +
        ` data-edit-col="${col}"` +
        (editable ? ` data-editable="true"` : ``) +
        (i18nKey ? ` data-edit-i18n-key="${i18nKey}"` : ``) +
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

module.exports = { annotateSource, annotateInlineTemplates, columnAt, NEVER_COPY };
