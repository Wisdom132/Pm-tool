'use strict';

/**
 * Reading a translation key out of a template expression.
 *
 * Text rendered through a translation function has no literal in the
 * component — the copy lives in a locale file. Without the key, that copy is
 * simply unreachable: the element holds no text to annotate, so it is never
 * offered, and the editor has nothing to redirect to `locale.js`.
 *
 * React reads its keys from the Babel AST. Vue, Svelte and Angular all hand
 * us an expression as a *string* — from an interpolation node or straight
 * out of the markup — so they share this.
 *
 * Deliberately conservative. A key that is guessed wrong sends an edit into
 * the wrong entry of a locale file, which is worse than not offering the
 * edit: nothing in the pull request would look out of place.
 */

/** Functions whose first string argument is a translation key. */
const TRANSLATE_FNS = new Set([
  't',
  '$t',
  'translate',
  'i18n',
  // svelte-i18n exposes a store, used as `$_('key')` or `$t('key')`.
  '_',
  '$_',
]);

/** `'key'` or `"key"` — nothing computed, nothing concatenated. */
const STRING_LITERAL = /^\s*(['"])((?:(?!\1)[^\\])*)\1\s*$/;

/**
 * A call to a translation function, and nothing else.
 *
 * `t('a')` and `i18n.t('a')` qualify. `t(key)` does not — the key is
 * computed, so there is no entry to point at. `t('a') + x` does not either:
 * the expression is not *only* the call.
 */
function fromCall(expression) {
  const source = String(expression ?? '').trim();

  const open = source.indexOf('(');
  if (open === -1 || !source.endsWith(')')) return null;

  // The callee, with any object path stripped: `i18n.t` -> `t`.
  const callee = source.slice(0, open).trim();
  if (!/^[\w$.]+$/.test(callee)) return null;

  const name = callee.slice(callee.lastIndexOf('.') + 1);
  if (!TRANSLATE_FNS.has(name)) return null;

  const args = source.slice(open + 1, -1);

  // Only the first argument, and only when it is a plain string. An
  // interpolation count or a default value may follow it.
  const first = splitFirstArgument(args);
  const literal = STRING_LITERAL.exec(first);
  return literal ? literal[2] : null;
}

/**
 * The Angular idiom: `'key' | translate`, and transloco's `'key' | transloco`.
 *
 * The pipe is the dominant form in Angular templates, and it reads the other
 * way round from a call — the key comes first.
 */
function fromPipe(expression) {
  const source = String(expression ?? '').trim();

  // Split on a single `|`, not `||`.
  const bar = findPipe(source);
  if (bar === -1) return null;

  const left = source.slice(0, bar);
  const right = source.slice(bar + 1).trim();

  // `translate` or `transloco`, optionally with pipe arguments after a `:`.
  const pipeName = right.split(':')[0].trim();
  if (!['translate', 'transloco', 'i18next'].includes(pipeName)) return null;

  const literal = STRING_LITERAL.exec(left);
  return literal ? literal[2] : null;
}

/** Either form. */
function translationKey(expression) {
  return fromCall(expression) ?? fromPipe(expression);
}

/** The first argument of a call, respecting nesting and quotes. */
function splitFirstArgument(args) {
  let depth = 0;
  let quote = '';

  for (let i = 0; i < args.length; i++) {
    const ch = args[i];

    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) return args.slice(0, i);
  }

  return args;
}

/** Index of a single `|` outside quotes, or -1. */
function findPipe(source) {
  let quote = '';

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '|') {
      // `||` is logical or, not a pipe.
      if (source[i + 1] === '|' || source[i - 1] === '|') {
        i++;
        continue;
      }
      return i;
    }
  }

  return -1;
}

module.exports = { translationKey, fromCall, fromPipe, TRANSLATE_FNS };
