import { describe, it, expect } from 'vitest';
import { resolveRef } from '../apps/api/src/editing/resolve-ref';

const read = (environmentBranch, requested) =>
  resolveRef({ mode: 'read', environmentBranch, requested });
const write = (environmentBranch, requested) =>
  resolveRef({ mode: 'write', environmentBranch, requested });

describe('writes pin to the registered branch', () => {
  it('ignores a branch the caller asked for', () => {
    // The security property: a page cannot redirect an edit to a branch its
    // editors were never pointed at.
    expect(write('main', 'attacker-branch')).toBe('main');
  });

  it('ignores a caller-supplied commit too', () => {
    expect(write('main', 'a'.repeat(40))).toBe('main');
  });

  it('falls back to the caller for a preview deploy', () => {
    // Null means "the branch comes from the page" — per-deployment, and the
    // only case where the caller is the authority.
    expect(write(null, 'feature/checkout')).toBe('feature/checkout');
  });

  it('has nothing to use when a preview deploy sends no branch', () => {
    expect(write(null, undefined)).toBe(null);
    expect(write(null, '')).toBe(null);
    expect(write(null, '   ')).toBe(null);
  });
});

describe('reads may name a ref', () => {
  it('honours a commit, so the editor sees the file they are looking at', () => {
    // This is what the build annotation is for. Pinning reads to the branch
    // tip shows a file the editor is not looking at.
    const commit = 'a'.repeat(40);
    expect(read('main', commit)).toBe(commit);
  });

  it('honours another branch', () => {
    expect(read('main', 'develop')).toBe('develop');
  });

  it('falls back to the registered branch when none is asked for', () => {
    expect(read('main', undefined)).toBe('main');
    expect(read('main', '')).toBe('main');
  });

  it('has nothing to use when neither side names one', () => {
    expect(read(null, undefined)).toBe(null);
  });
});

describe('both modes', () => {
  it('trims whitespace rather than treating it as a ref', () => {
    expect(read('main', '  develop  ')).toBe('develop');
    expect(write('  main  ', undefined)).toBe('main');
  });

  it('differ only when both sides name something', () => {
    // The one case where the mode matters at all.
    expect(read('main', 'develop')).toBe('develop');
    expect(write('main', 'develop')).toBe('main');
  });
});
