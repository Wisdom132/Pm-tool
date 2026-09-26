/**
 * Codemod dispatch.
 *
 * Every backend applies all of a file's edits in one pass and reports which
 * succeeded, so a single unlocatable string no longer aborts the whole
 * pull request the way a thrown error did.
 */

import { applyJsxEdits } from './jsx.js';
import { applyVueEdits } from './vue.js';
import { applyHtmlEdits } from './html.js';
import { applyTextEdits } from './text.js';
import { applyLocaleEdits } from './locale.js';
import { log } from '../logger.js';

const BY_EXTENSION = {
  '.jsx': applyJsxEdits,
  '.tsx': applyJsxEdits,
  '.js': applyJsxEdits,
  '.mjs': applyJsxEdits,
  '.ts': applyJsxEdits,
  '.vue': applyVueEdits,
  '.html': applyHtmlEdits,
  '.htm': applyHtmlEdits,
};

function extensionOf(filePath) {
  const dot = filePath.lastIndexOf('.');
  return dot === -1 ? '' : filePath.slice(dot).toLowerCase();
}

/**
 * Apply all edits for one file.
 *
 * @param {{content: string, filePath: string, edits: object[]}} input
 * @returns {{content: string, applied: object[], failed: Array<{edit, reason}>}}
 */
export function applyEditsToFile({ content, filePath, edits }) {
  // Edits redirected to a locale file are keyed, not positioned.
  if (edits.every((e) => e.i18nKey) && filePath.endsWith('.json')) {
    return applyLocaleEdits(content, filePath, edits);
  }

  const backend = BY_EXTENSION[extensionOf(filePath)];

  if (!backend) {
    return applyTextEdits(content, filePath, edits);
  }

  try {
    return backend(content, filePath, edits);
  } catch (err) {
    // A parse failure should not lose the edits: fall back to the literal
    // string replacement, which needs no syntax understanding.
    log.warn('codemod.fallback', { filePath, error: err.message });
    return applyTextEdits(content, filePath, edits);
  }
}
