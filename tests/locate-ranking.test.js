import { describe, it, expect } from 'vitest';
import { scorePath, MIN_SEARCH_LENGTH } from '../apps/api/src/editing/locate-ranking.js';

describe('candidate ranking', () => {
  const better = (a, b) => scorePath(a) > scorePath(b);

  it('prefers component and page sources', () => {
    expect(better('src/components/Hero.tsx', 'scripts/seed.js')).toBe(true);
    expect(better('app/pages/index.jsx', 'config/defaults.js')).toBe(true);
  });

  it('demotes build output', () => {
    expect(better('src/Hero.tsx', 'dist/Hero.js')).toBe(true);
    expect(better('src/Hero.tsx', 'build/static/Hero.js')).toBe(true);
    expect(better('src/Hero.tsx', 'node_modules/pkg/Hero.jsx')).toBe(true);
  });

  it('demotes tests, stories and mocks', () => {
    expect(better('src/Hero.tsx', 'src/Hero.test.tsx')).toBe(true);
    expect(better('src/Hero.tsx', 'src/Hero.stories.tsx')).toBe(true);
    expect(better('src/Hero.tsx', 'src/__tests__/Hero.tsx')).toBe(true);
  });

  it('prefers shallower paths between equals', () => {
    expect(better('src/Hero.tsx', 'src/a/b/c/d/Hero.tsx')).toBe(true);
  });

  it('prefers component file types', () => {
    expect(better('src/Hero.tsx', 'src/hero.js')).toBe(true);
  });
});

describe('search threshold', () => {
  it('is long enough that common words are not searched', () => {
    // "Save" or "Home" would match half a codebase; a human confirming
    // that list is worse than being told to annotate the page.
    expect(MIN_SEARCH_LENGTH).toBeGreaterThanOrEqual(8);
  });
});
