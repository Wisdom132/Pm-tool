'use strict';

const {
  NEVER_COPY,
  TAG_RE: tagScanner,
  lineAt,
  columnAt,
  findOpenTagEnd,
  findCloseTag,
} = require('../lib/markup-scan.js');
const { translationKey } = require('../lib/i18n-key.js');

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

  const TAG_RE = tagScanner();
  let match;

  // Elements not nested inside another element in this file. Tags arrive in
  // document order, so anything starting past the previous root's close is
  // itself a root.
  let rootEnd = -1;

  while ((match = TAG_RE.exec(masked)) !== null) {
    const start = match.index;
    const raw = match[1];
    const tag = raw.toLowerCase();

    // A capitalised tag is a component: its children are slot content handed
    // to something else, and the element that finally renders them is not
    // this one. The old allowlist excluded these by accident — every entry
    // was lowercase — so widening the scanner had to make it deliberate.
    if (/^[A-Z]/.test(raw)) continue;
    if (NEVER_COPY.includes(tag)) continue;
    const isRoot = start >= rootEnd;

    const openTagEnd = findOpenTagEnd(masked, start);
    const openTag = masked.slice(start, openTagEnd);
    const selfClosing = openTag.trimEnd().endsWith('/>');
    const closeAt = selfClosing ? openTagEnd : findCloseTag(masked, tag, openTagEnd);

    // Advance the root span *before* any skip. Doing it after meant that on
    // a second pass the already-annotated root was skipped, `rootEnd` stayed
    // behind, and a nested child was mistaken for a root — annotated again,
    // with a column measured into the already-annotated string. Build tools
    // do run a transform more than once.
    if (isRoot && closeAt !== null) rootEnd = closeAt;

    if (selfClosing) continue;
    // Idempotent: re-running the plugin must not stack attributes.
    if (openTag.includes('data-edit-file')) continue;
    if (closeAt === null) continue;

    const inner = source.slice(openTagEnd, closeAt);

    // Child elements mean the text is not this element's to rewrite, and
    // `{count}` is a value the component computes — neither is editable
    // copy, so neither earns an *edit*.
    const literal =
      !/[<>]/.test(inner) && !/\{/.test(inner) && Boolean(inner.trim());

    // `{$_('hero.title')}` is copy, it just lives in a locale file. Without
    // the key it is unreachable: no literal to annotate, and nothing for the
    // service to redirect. A lone expression only, so that `Hi {$_('n')}`
    // — which is two things — is not mistaken for one.
    const lone = /^\s*\{([\s\S]*)\}\s*$/.exec(inner);
    const i18nKey = literal || !lone ? null : translationKey(lone[1]);

    const editable = literal || Boolean(i18nKey);

    // A root still earns *provenance*. `data-editable` says the codemod can
    // rewrite this; `data-edit-file` says where it came from. Emitting only
    // the pair left an image, an icon or a wrapper with no annotated
    // ancestor anywhere, so Inspect and Comment could name no file for it.
    // Provenance goes on every element, not only editable ones and the
    // root. Containers are what Rearrange moves and what Design pads, and
    // without an annotation those tools refuse — on a real page that was
    // four elements in five. `data-editable` stays narrow; only the claim
    // "this came from here" is widened, and that claim is true of every
    // element the file produced.
    void isRoot;

    mutations.push({
      offset: start + 1 + tag.length,
      text:
        ` data-edit-file="${filePath}"` +
        ` data-edit-line="${lineAt(masked, start)}"` +
        ` data-edit-col="${columnAt(masked, start)}"` +
        (editable ? ` data-editable="true"` : ``) +
        (i18nKey ? ` data-edit-i18n-key="${i18nKey}"` : ``) +
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
  NEVER_COPY,
};
