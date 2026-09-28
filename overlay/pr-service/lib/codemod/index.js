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
import {
  applyStructuralEdits,
  applyHtmlStructuralEdits,
  applyVueStructuralEdits,
  STRUCTURAL_OPS,
} from './structure.js';
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
  // Svelte markup is HTML at the top level, so the same scanner applies.
  '.svelte': applyHtmlEdits,
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

  // Structural edits rewrite whole elements. Run them in their own pass so
  // their ranges cannot collide with a text or attribute rewrite inside the
  // very element being moved or removed.
  const structural = edits.filter((e) => STRUCTURAL_OPS.has(e.op));
  if (structural.length > 0) {
    const others = edits.filter((e) => !STRUCTURAL_OPS.has(e.op));

    let result = { content, applied: [], failed: [] };
    if (others.length > 0) {
      result = applyEditsToFile({ content, filePath, edits: others });
    }

    // Markup files need the scanner, not the JSX parser — routing a .vue or
    // .html file through Babel produced a parse error and made the Rearrange
    // tool look broken on anything but React.
    const structuralBackend = /\.vue$/i.test(filePath)
      ? applyVueStructuralEdits
      : /\.(html?|svelte)$/i.test(filePath)
        ? applyHtmlStructuralEdits
        : applyStructuralEdits;

    try {
      const structuralResult = structuralBackend(result.content, filePath, structural);
      return {
        content: structuralResult.content,
        applied: [...result.applied, ...structuralResult.applied],
        failed: [...result.failed, ...structuralResult.failed],
      };
    } catch (err) {
      log.warn('codemod.structural_failed', { filePath, error: err.message });
      return {
        ...result,
        failed: [
          ...result.failed,
          ...structural.map((edit) => ({ edit, reason: `Could not parse ${filePath}: ${err.message}` })),
        ],
      };
    }
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
