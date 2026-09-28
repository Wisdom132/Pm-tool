import { describe, it, expect } from 'vitest';
import { buildStalenessNote, buildPrBody } from '../apps/api/src/editing/patcher.js';

describe('buildStalenessNote', () => {
  it('says nothing when the preview matches the branch', () => {
    expect(buildStalenessNote({ status: 'identical', behindBy: 0, usable: true })).toBe('');
  });

  it('says nothing when there was no commit to compare', () => {
    expect(buildStalenessNote(null)).toBe('');
    expect(buildStalenessNote(undefined)).toBe('');
  });

  it('notes how far behind a usable preview was', () => {
    const note = buildStalenessNote({ status: 'ahead', behindBy: 3, usable: true });
    expect(note).toContain('3 commit(s) behind');
    expect(note).toContain('only the changes made in the browser');
  });

  it('warns loudly when the build commit is unreachable', () => {
    const note = buildStalenessNote({ status: 'diverged', behindBy: 0, usable: false });
    expect(note).toContain('no longer on this branch');
    expect(note).toContain('rebased or force-pushed');
  });

  it('warns when the comparison could not be made', () => {
    expect(buildStalenessNote({ status: 'unknown', usable: false })).toContain('⚠️');
  });
});

describe('buildPrBody with staleness', () => {
  const base = {
    edits: [
      { sourceFile: 'src/Hero.tsx', sourceLine: 12, originalText: 'a', newText: 'b' },
    ],
    editor: { login: 'octocat' },
    pageUrl: 'https://preview.example.com/',
  };

  it('omits the section for a current preview', () => {
    const body = buildPrBody({ ...base, staleness: { status: 'identical', usable: true } });
    expect(body).not.toContain('behind');
  });

  it('includes the section for a stale preview', () => {
    const body = buildPrBody({
      ...base,
      staleness: { status: 'ahead', behindBy: 2, usable: true },
    });
    expect(body).toContain('2 commit(s) behind');
  });

  it('keeps the edit table alongside the warning', () => {
    const body = buildPrBody({
      ...base,
      staleness: { status: 'diverged', usable: false },
    });
    expect(body).toContain('`src/Hero.tsx:12`');
    expect(body).toContain('rebased or force-pushed');
    expect(body).toContain('Opened by **@octocat**');
  });

  it('is unaffected when staleness is absent', () => {
    expect(buildPrBody(base)).toBe(buildPrBody({ ...base, staleness: null }));
  });
});
