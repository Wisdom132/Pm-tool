import { describe, it, expect } from 'vitest';
import {
  isSourceLocaleFile,
  rankLocaleFiles,
  readKey,
  setKeyInJson,
  applyLocaleEdits,
} from '../overlay/pr-service/lib/codemod/locale.js';

const EN = `{
  "hero": {
    "title": "Build things that mater",
    "subtitle": "Ship fast"
  },
  "nav": {
    "home": "Home"
  }
}
`;

describe('isSourceLocaleFile', () => {
  it.each([
    'locales/en.json',
    'locales/en/common.json',
    'public/locales/en/translation.json',
    'src/i18n/en.json',
    'messages/en.json',
    'translations/en-US.json',
  ])('accepts %s', (p) => {
    expect(isSourceLocaleFile(p)).toBe(true);
  });

  it.each([
    'locales/fr.json',
    'package.json',
    'src/components/en.json',
    'locales/en.yaml',
  ])('rejects %s', (p) => {
    expect(isSourceLocaleFile(p)).toBe(false);
  });
});

describe('rankLocaleFiles', () => {
  it('filters to source-locale files and prefers shallower paths', () => {
    expect(
      rankLocaleFiles([
        'src/deeply/nested/locales/en/a.json',
        'locales/en.json',
        'locales/fr.json',
        'package.json',
      ])
    ).toEqual(['locales/en.json', 'src/deeply/nested/locales/en/a.json']);
  });
});

describe('readKey', () => {
  const obj = JSON.parse(EN);

  it('reads a nested key', () => {
    expect(readKey(obj, 'hero.title')).toBe('Build things that mater');
  });

  it('returns undefined for a missing key', () => {
    expect(readKey(obj, 'hero.missing')).toBeUndefined();
    expect(readKey(obj, 'nope.deeply.missing')).toBeUndefined();
  });
});

describe('setKeyInJson', () => {
  it('replaces the value', () => {
    const { content } = setKeyInJson(EN, 'hero.title', 'Build things that matter');
    expect(JSON.parse(content).hero.title).toBe('Build things that matter');
  });

  it('preserves formatting everywhere else', () => {
    // Re-serialising with JSON.stringify would reindent the whole file and
    // turn a one-word change into a whole-file diff.
    const { content } = setKeyInJson(EN, 'hero.title', 'Build things that matter');
    const before = EN.split('\n');
    const after = content.split('\n');
    expect(after.length).toBe(before.length);
    after.forEach((line, i) => {
      if (!line.includes('matter')) expect(line).toBe(before[i]);
    });
  });

  it('keeps the trailing newline', () => {
    const { content } = setKeyInJson(EN, 'nav.home', 'Start');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('escapes the replacement', () => {
    const { content } = setKeyInJson(EN, 'nav.home', 'He said "hi"');
    expect(JSON.parse(content).nav.home).toBe('He said "hi"');
  });

  it('returns null for a missing key', () => {
    expect(setKeyInJson(EN, 'hero.nope', 'x')).toBeNull();
  });

  it('returns null when the value is not a string', () => {
    expect(setKeyInJson('{"a": {"b": 1}}', 'a', 'x')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(setKeyInJson('{ not json', 'a', 'x')).toBeNull();
  });
});

describe('applyLocaleEdits', () => {
  it('applies several keys in one file', () => {
    const { content, applied } = applyLocaleEdits(EN, 'locales/en.json', [
      { i18nKey: 'hero.title', originalText: 'x', newText: 'Matter' },
      { i18nKey: 'nav.home', originalText: 'Home', newText: 'Start' },
    ]);

    expect(applied).toHaveLength(2);
    const parsed = JSON.parse(content);
    expect(parsed.hero.title).toBe('Matter');
    expect(parsed.nav.home).toBe('Start');
  });

  it('reports an unknown key without losing the others', () => {
    const { content, applied, failed } = applyLocaleEdits(EN, 'locales/en.json', [
      { i18nKey: 'hero.title', originalText: 'x', newText: 'Matter' },
      { i18nKey: 'hero.absent', originalText: 'x', newText: 'y' },
    ]);

    expect(applied).toHaveLength(1);
    expect(failed[0].reason).toMatch(/not a string/);
    expect(JSON.parse(content).hero.title).toBe('Matter');
  });

  it('records the locale file as the edit source', () => {
    const { applied } = applyLocaleEdits(EN, 'locales/en.json', [
      { i18nKey: 'nav.home', originalText: 'Home', newText: 'Start' },
    ]);
    expect(applied[0].sourceFile).toBe('locales/en.json');
  });
});
