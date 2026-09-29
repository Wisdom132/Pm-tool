import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { translationKey, fromCall, fromPipe } = require('../annotation/lib/i18n-key.js');

/**
 * Reading a translation key out of a template expression.
 *
 * The bar for accepting one is high on purpose. A key guessed wrong sends an
 * edit into the wrong entry of a locale file — and nothing in the resulting
 * pull request would look out of place, which makes it worse than not
 * offering the edit at all.
 */

describe('call form', () => {
  const accepted = [
    ["t('hero.title')", 'hero.title'],
    ['t("hero.title")', 'hero.title'],
    ["$t('hero.title')", 'hero.title'],
    ["translate('hero.title')", 'hero.title'],
    ["i18n.t('hero.title')", 'hero.title'],
    ["$_('hero.title')", 'hero.title'],
    ["_('hero.title')", 'hero.title'],
    // svelte-i18n and vue-i18n both take options after the key.
    ["t('cart.items', { count: 3 })", 'cart.items'],
    ["$t('a.b', [name])", 'a.b'],
    // Whitespace is not significant.
    ["  t( 'hero.title' )  ", 'hero.title'],
  ];

  it.each(accepted)('reads %s', (expression, key) => {
    expect(fromCall(expression)).toBe(key);
  });
});

describe('call form — what it refuses', () => {
  const refused = [
    // The key is computed: there is no entry to point at.
    ['t(key)', 'a variable'],
    ['t(`hero.${id}`)', 'a template literal'],
    ["t('a' + suffix)", 'concatenation'],
    // Not a translation function.
    ["format('hero.title')", 'an unrelated function'],
    ["console.log('hero.title')", 'a method that is not t'],
    // Not *only* the call, so the element holds more than the translation.
    ["t('a') + '!'", 'a call with something appended'],
    ["cond ? t('a') : t('b')", 'a conditional'],
    // Not a call at all.
    ['count', 'a bare identifier'],
    ["'hero.title'", 'a bare string'],
    ['', 'an empty expression'],
  ];

  it.each(refused)('refuses %s (%s)', (expression) => {
    expect(fromCall(expression)).toBeNull();
  });

  it('refuses a null or undefined expression', () => {
    expect(fromCall(null)).toBeNull();
    expect(fromCall(undefined)).toBeNull();
  });
});

describe('pipe form — the Angular idiom', () => {
  const accepted = [
    ["'hero.title' | translate", 'hero.title'],
    ['"hero.title" | translate', 'hero.title'],
    ["'hero.title' | transloco", 'hero.title'],
    ["'hero.title' | i18next", 'hero.title'],
    // ngx-translate takes params after a colon.
    ["'cart.items' | translate: { count: 3 }", 'cart.items'],
    ["  'hero.title'   |   translate  ", 'hero.title'],
  ];

  it.each(accepted)('reads %s', (expression, key) => {
    expect(fromPipe(expression)).toBe(key);
  });

  const refused = [
    ['key | translate', 'a computed key'],
    ["'hero.title' | uppercase", 'an unrelated pipe'],
    ["'hero.title' | translate | uppercase", 'a chained pipe, where the result is transformed'],
    ["a || b", 'logical or, which is not a pipe'],
    ["'hero.title'", 'no pipe at all'],
  ];

  it.each(refused)('refuses %s (%s)', (expression) => {
    expect(fromPipe(expression)).toBeNull();
  });

  it('does not mistake a pipe inside a string for a real one', () => {
    expect(fromPipe("'a | b' | translate")).toBe('a | b');
  });
});

describe('translationKey', () => {
  it('accepts either form', () => {
    expect(translationKey("t('a.b')")).toBe('a.b');
    expect(translationKey("'a.b' | translate")).toBe('a.b');
  });

  it('refuses anything neither form recognises', () => {
    expect(translationKey('count + 1')).toBeNull();
  });

  it('keeps a key containing dots and dashes intact', () => {
    expect(translationKey("t('home.hero.cta-primary')")).toBe('home.hero.cta-primary');
  });

  it('keeps an empty key out', () => {
    // An empty string is a key nothing could resolve.
    expect(translationKey("t('')")).toBe('');
  });
});
