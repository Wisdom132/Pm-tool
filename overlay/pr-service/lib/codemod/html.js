/**
 * HTML codemod, used for Angular templates and plain .html files.
 *
 * Ranges come from a depth-aware scanner rather than a "first closing tag
 * wins" search, so nested elements of the same name resolve correctly.
 */

import MagicString from 'magic-string';
import { chooseCandidate, describeFailure } from './locate.js';
import { findElements, lineAt, columnAt } from './element-range.js';

const TEXT_TAGS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'span', 'a', 'button', 'label',
  'li', 'td', 'th',
  'strong', 'em', 'small', 'b', 'i',
];

/**
 * Blank out <script> and <style> bodies, keeping every offset and line.
 *
 * Their contents are JavaScript and CSS, where a `<p>` in a string literal or
 * a `p { }` selector is not markup. Every Svelte component has a script
 * block, so scanning one unmasked would eventually rewrite code as if it
 * were copy. Offsets are preserved so ranges still apply to the real source.
 */
function maskBlocks(source) {
  return source.replace(
    /(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi,
    (all, open, name, body, close) => open + body.replace(/[^\n]/g, ' ') + close
  );
}

/** Elements whose content is purely text, so it can be replaced wholesale. */
function collectTextNodes(rawSource) {
  const found = [];
  const source = maskBlocks(rawSource);

  for (const range of findElements(source, TEXT_TAGS)) {
    if (range.selfClosing) continue;

    const inner = source.slice(range.innerStart, range.innerEnd);
    // Markup or an interpolation inside means rewriting would destroy it.
    // Angular and Vue use `{{ }}`; Svelte uses a single brace, and losing a
    // `{count}` would replace a rendered value with static text.
    if (/[<>]/.test(inner) || /\{/.test(inner)) continue;
    if (!inner.trim()) continue;

    found.push({
      line: lineAt(source, range.start),
      column: columnAt(source, range.start),
      text: inner.replace(/\s+/g, ' ').trim(),
      node: { start: range.innerStart, end: range.innerEnd },
    });
  }

  return found;
}

/** Attribute values on any element, not just text-bearing ones. */
function collectAttributes(rawSource) {
  const found = [];
  const source = maskBlocks(rawSource);
  const tagRe = /<([a-zA-Z][\w-]*)((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
  let tag;

  while ((tag = tagRe.exec(source)) !== null) {
    const attrsStart = tag.index + 1 + tag[1].length;
    const attrRe = /([^\s=]+)\s*=\s*"([^"]*)"/g;
    let attr;

    while ((attr = attrRe.exec(tag[2])) !== null) {
      const valueStart = attrsStart + attr.index + attr[0].indexOf('"') + 1;
      found.push({
        line: lineAt(source, tag.index),
        column: columnAt(source, tag.index),
        attribute: attr[1],
        text: attr[2],
        node: { start: valueStart, end: valueStart + attr[2].length },
      });
    }
  }

  return found;
}

export function applyHtmlEdits(source, filePath, edits) {
  const candidates = collectTextNodes(source);
  const attrCandidates = collectAttributes(source);
  const s = new MagicString(source);

  const applied = [];
  const failed = [];
  const usedRanges = [];

  for (const edit of edits) {
    const pool = edit.attribute
      ? attrCandidates.filter((c) => c.attribute === edit.attribute)
      : candidates;

    const chosen = chooseCandidate(pool, edit);
    if (!chosen) {
      failed.push({
        edit,
        reason:
          edit.attribute && pool.length === 0
            ? `No editable ${edit.attribute}="..." found in ${filePath}.`
            : describeFailure(pool, edit),
      });
      continue;
    }

    const { start, end } = chosen.node;
    if (usedRanges.some((r) => start < r.end && end > r.start)) {
      failed.push({ edit, reason: `Two edits resolved to the same place in ${filePath}.` });
      continue;
    }

    if (edit.attribute) {
      s.overwrite(start, end, edit.newText.replace(/"/g, '&quot;'));
      usedRanges.push({ start, end });
      applied.push({ ...edit, _match: chosen.match });
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

export const __test__ = { collectTextNodes, collectAttributes };
