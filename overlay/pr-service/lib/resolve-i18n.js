/**
 * Point i18n edits at the locale file that actually holds their text.
 *
 * The annotation plugin stamps `data-edit-i18n-key` on elements rendered
 * through a translation function. The component has no literal to change, so
 * the edit is redirected to the source-locale JSON before any codemod runs.
 */

import { getFileContent, listTreePaths } from './github.js';
import { rankLocaleFiles, readKey } from './codemod/locale.js';
import { log } from './logger.js';

/**
 * Rewrite each i18n edit's sourceFile to the locale file containing its key.
 *
 * Edits whose key cannot be found anywhere are returned unchanged with a
 * `_i18nUnresolved` reason, so they surface as skipped rather than being
 * written into the wrong file.
 *
 * @returns {Promise<object[]>}
 */
export async function resolveI18nEdits({ token, owner, repo, branch, edits }) {
  const i18nEdits = edits.filter((e) => e.i18nKey);
  if (i18nEdits.length === 0) return edits;

  let candidates;
  try {
    candidates = rankLocaleFiles(await listTreePaths({ token, owner, repo, branch }));
  } catch (err) {
    log.warn('i18n.tree_failed', { repo: `${owner}/${repo}`, error: err.message });
    return edits;
  }

  if (candidates.length === 0) {
    log.warn('i18n.no_locale_files', { repo: `${owner}/${repo}` });
    return edits.map((e) =>
      e.i18nKey
        ? { ...e, _i18nUnresolved: 'No locale files found in this repository.' }
        : e
    );
  }

  // Parse each candidate once, then answer every key from the cache.
  const parsed = new Map();
  for (const path of candidates) {
    try {
      const { content } = await getFileContent({ token, owner, repo, path, branch });
      parsed.set(path, JSON.parse(content));
    } catch {
      // Unreadable or malformed — just not a candidate.
    }
  }

  return edits.map((edit) => {
    if (!edit.i18nKey) return edit;

    const match = candidates.find(
      (path) => parsed.has(path) && typeof readKey(parsed.get(path), edit.i18nKey) === 'string'
    );

    if (!match) {
      return {
        ...edit,
        _i18nUnresolved: `Translation key "${edit.i18nKey}" was not found in any locale file.`,
      };
    }

    log.debug('i18n.resolved', { key: edit.i18nKey, file: match });
    return { ...edit, sourceFile: match, sourceLine: undefined, _i18nFile: true };
  });
}
