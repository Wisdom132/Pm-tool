import { describe, it, expect } from 'vitest';
import { assertSourcePath, isSourcePath } from '../apps/api/src/editing/source-path';

describe('assertSourcePath — what it accepts', () => {
  const valid = [
    'src/components/Hero.vue',
    'app/page.tsx',
    'index.html',
    'locales/en.json',
    'src/my-file_v2.test.ts',
    'components/[slug]/page.tsx',
    'src/(marketing)/home.tsx',
    'a/b/c/d/e/f/g/Deep.svelte',
    'file with spaces.html',
    "O'Brien.vue",
  ];

  it.each(valid)('accepts %s', (path) => {
    expect(assertSourcePath(path)).toBe(path);
  });
});

describe('assertSourcePath — traversal', () => {
  it('rejects a parent-directory segment', () => {
    for (const bad of ['../secrets.env', 'src/../../etc/passwd', 'a/../../b', '..']) {
      expect(() => assertSourcePath(bad), bad).toThrow(/traverses outside/);
    }
  });

  it('rejects a current-directory segment', () => {
    expect(() => assertSourcePath('./src/a.ts')).toThrow(/traverses outside/);
  });

  it('accepts a filename that merely contains dots', () => {
    // The old substring check on '..' rejected these, which is wrong.
    expect(assertSourcePath('src/foo..bar.ts')).toBe('src/foo..bar.ts');
    expect(assertSourcePath('src/a...b.ts')).toBe('src/a...b.ts');
  });

  it('rejects percent-encoded traversal', () => {
    // The case the old check missed entirely.
    for (const bad of ['%2e%2e%2fsecrets', 'src%2F..%2Fetc', '..%2fetc%2fpasswd']) {
      expect(() => assertSourcePath(bad), bad).toThrow();
    }
  });

  it('rejects double-encoded traversal', () => {
    expect(() => assertSourcePath('%252e%252e%252f')).toThrow();
  });
});

describe('assertSourcePath — absolute and platform paths', () => {
  it('rejects an absolute posix path', () => {
    expect(() => assertSourcePath('/etc/passwd')).toThrow(/relative to the repository root/);
  });

  it('rejects an absolute windows path', () => {
    expect(() => assertSourcePath('C:/Windows/System32')).toThrow(/absolute Windows path/);
  });

  it('rejects backslashes', () => {
    expect(() => assertSourcePath('src\\components\\Hero.vue')).toThrow(/forward slashes/);
    expect(() => assertSourcePath('\\\\server\\share')).toThrow();
  });
});

describe('assertSourcePath — other refusals', () => {
  it('rejects the git directory', () => {
    expect(() => assertSourcePath('.git/config')).toThrow(/git directory/);
  });

  it('rejects empty segments', () => {
    expect(() => assertSourcePath('src//Hero.vue')).toThrow(/empty path segment/);
    expect(() => assertSourcePath('src/')).toThrow(/empty path segment/);
  });

  it('rejects control characters and newlines', () => {
    expect(() => assertSourcePath('src/a\nb.ts')).toThrow(/control characters/);
    expect(() => assertSourcePath('src/a\u0000.ts')).toThrow(/control characters/);
  });

  it('rejects an over-long path', () => {
    expect(() => assertSourcePath('a/'.repeat(300) + 'b.ts')).toThrow();
  });

  it('rejects an absurdly deep path', () => {
    expect(() => assertSourcePath('a/'.repeat(40) + 'b.ts')).toThrow(/directories deep/);
  });

  it('rejects empty and non-string input', () => {
    for (const bad of ['', undefined, null, 42, {}]) {
      expect(() => assertSourcePath(bad)).toThrow();
    }
  });

  it('names the offending segment, so the cause is visible', () => {
    expect(() => assertSourcePath('src/a*b.ts')).toThrow(/"a\*b\.ts" is not a valid file/);
  });
});

describe('isSourcePath', () => {
  it('is the non-throwing form', () => {
    expect(isSourcePath('src/a.ts')).toBe(true);
    expect(isSourcePath('../a.ts')).toBe(false);
    expect(isSourcePath(undefined)).toBe(false);
  });
});
