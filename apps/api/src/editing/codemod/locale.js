/**
 * Locale file editing.
 *
 * Text rendered through `t('hero.title')` lives in a translation file, not in
 * the component. Patching the component would be wrong twice over: the
 * literal is not there to change, and the other languages would silently
 * drift from the source one.
 */

import MagicString from 'magic-string';

/** Directory names that mark a translations tree. */
const LOCALE_DIR = /(^|\/)(locales?|lang|langs|i18n|translations?|messages)(\/|$)/i;

/** Default source locale, by convention the one the developer writes in. */
const SOURCE_LOCALES = ['en', 'en-US', 'en-GB', 'default', 'source'];

/** Does this path look like a translation file for the source locale? */
export function isSourceLocaleFile(path) {
  if (!path.endsWith('.json')) return false;
  if (!LOCALE_DIR.test(path)) return false;

  const segments = path.split('/');
  const fileName = segments[segments.length - 1].replace(/\.json$/, '');
  const parent = segments[segments.length - 2] || '';

  // Either locales/en.json or locales/en/common.json
  return (
    SOURCE_LOCALES.some((l) => l.toLowerCase() === fileName.toLowerCase()) ||
    SOURCE_LOCALES.some((l) => l.toLowerCase() === parent.toLowerCase())
  );
}

/** Rank candidates so the most likely locale file is tried first. */
export function rankLocaleFiles(paths) {
  return paths
    .filter(isSourceLocaleFile)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

/** Read a dotted key out of a parsed object. */
export function readKey(object, key) {
  return key.split('.').reduce((node, part) => {
    if (node && typeof node === 'object' && part in node) return node[part];
    return undefined;
  }, object);
}

/**
 * Replace a dotted key's string value, touching only that value's characters.
 *
 * The file is not re-serialised: JSON.stringify would reorder nothing but
 * would reformat indentation and strip the trailing newline, turning a
 * one-word change into a whole-file diff.
 *
 * @returns {{content: string}|null} null when the key is absent or not a string
 */
export function setKeyInJson(source, key, newValue) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }

  const current = readKey(parsed, key);
  if (typeof current !== 'string') return null;

  const range = findStringValueRange(source, key.split('.'));
  if (!range) return null;

  const s = new MagicString(source);
  s.overwrite(range.start, range.end, JSON.stringify(newValue));
  return { content: s.toString() };
}

/**
 * Locate the character range of a nested key's value by scanning the raw
 * text, so the original formatting can be preserved.
 */
function findStringValueRange(source, parts) {
  let searchFrom = 0;
  let depthGuard = 0;

  for (const part of parts) {
    const keyToken = JSON.stringify(part);
    const keyAt = source.indexOf(keyToken, searchFrom);
    if (keyAt === -1) return null;

    // Step past the key and its colon.
    let i = keyAt + keyToken.length;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] !== ':') return null;
    i++;
    while (i < source.length && /\s/.test(source[i])) i++;

    searchFrom = i;

    if (++depthGuard > parts.length) return null;
  }

  // searchFrom now points at the final value; it must be a string literal.
  if (source[searchFrom] !== '"') return null;

  let end = searchFrom + 1;
  while (end < source.length) {
    if (source[end] === '\\') {
      end += 2;
      continue;
    }
    if (source[end] === '"') {
      end++;
      break;
    }
    end++;
  }

  return { start: searchFrom, end };
}

/**
 * Apply i18n edits to one locale file.
 *
 * @param {string} source
 * @param {string} filePath
 * @param {Array<{i18nKey: string, originalText: string, newText: string}>} edits
 */
export function applyLocaleEdits(source, filePath, edits) {
  let content = source;
  const applied = [];
  const failed = [];

  for (const edit of edits) {
    const result = setKeyInJson(content, edit.i18nKey, edit.newText);

    if (!result) {
      failed.push({
        edit,
        reason: `Key "${edit.i18nKey}" is not a string in ${filePath}.`,
      });
      continue;
    }

    content = result.content;
    applied.push({ ...edit, _match: 'i18n-key', sourceFile: filePath });
  }

  return { content, applied, failed };
}
