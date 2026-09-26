import { describe, it, expect } from 'vitest';
import {
  createEditSession,
  SESSION_VERSION,
  SESSION_MAX_AGE_MS,
} from '../inline-edit-tool/extension/src/edit-session.js';

const edit = (over = {}) => ({
  key: 'src:Hero.tsx:12:4',
  pageUrl: 'https://preview.test/',
  sourceFile: 'src/Hero.tsx',
  sourceLine: 12,
  originalText: 'Build things that mater',
  originalRaw: '\n  Build things that mater\n',
  newText: 'Build things that matter',
  ...over,
});

describe('recording edits', () => {
  it('records a change', () => {
    const s = createEditSession();
    const { changed } = s.record(edit());
    expect(changed).toBe(true);
    expect(s.count()).toBe(1);
  });

  it('ignores a no-op', () => {
    const s = createEditSession();
    const { changed } = s.record(edit({ newText: 'Build things that mater' }));
    expect(changed).toBe(false);
    expect(s.count()).toBe(0);
  });

  it('updates in place rather than duplicating', () => {
    const s = createEditSession();
    s.record(edit());
    s.record(edit({ newText: 'Ship things' }));
    expect(s.count()).toBe(1);
    expect(s.get(edit().key).newText).toBe('Ship things');
  });

  it('keeps the first original text across repeated edits', () => {
    // The patch must describe the round trip from what is in the source file,
    // not from an intermediate value the editor typed along the way.
    const s = createEditSession();
    s.record(edit());
    s.record(edit({ newText: 'Ship things', originalText: 'Build things that matter' }));
    expect(s.get(edit().key).originalText).toBe('Build things that mater');
  });

  it('drops the edit when text returns to the original', () => {
    const s = createEditSession();
    s.record(edit());
    const { changed } = s.record(edit({ newText: 'Build things that mater' }));
    expect(changed).toBe(true);
    expect(s.count()).toBe(0);
  });

  it('reports no change when re-recording the same text', () => {
    const s = createEditSession();
    s.record(edit());
    expect(s.record(edit()).changed).toBe(false);
  });

  it('tracks several elements independently', () => {
    const s = createEditSession();
    s.record(edit());
    s.record(edit({ key: 'src:Nav.tsx:3:2' }));
    expect(s.count()).toBe(2);
  });

  it('requires a key', () => {
    const s = createEditSession();
    expect(() => s.record(edit({ key: undefined }))).toThrow(/key/);
  });
});

describe('undo and redo', () => {
  it('starts with neither available', () => {
    const s = createEditSession();
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
  });

  it('undoes a single edit', () => {
    const s = createEditSession();
    s.record(edit());
    const step = s.undo();
    expect(step).toEqual({ key: edit().key, edit: null });
    expect(s.count()).toBe(0);
  });

  it('redoes it again', () => {
    const s = createEditSession();
    s.record(edit());
    s.undo();
    const step = s.redo();
    expect(step.edit.newText).toBe('Build things that matter');
    expect(s.count()).toBe(1);
  });

  it('undoes an update back to the previous value', () => {
    const s = createEditSession();
    s.record(edit());
    s.record(edit({ newText: 'Ship things' }));
    const step = s.undo();
    expect(step.edit.newText).toBe('Build things that matter');
    expect(s.count()).toBe(1);
  });

  it('walks a multi-step history', () => {
    const s = createEditSession();
    s.record(edit());
    s.record(edit({ key: 'src:Nav.tsx:3:2', newText: 'Start' }));
    expect(s.count()).toBe(2);
    s.undo();
    expect(s.count()).toBe(1);
    s.undo();
    expect(s.count()).toBe(0);
    expect(s.canUndo()).toBe(false);
    s.redo();
    s.redo();
    expect(s.count()).toBe(2);
  });

  it('clears the redo stack once a new edit is made', () => {
    const s = createEditSession();
    s.record(edit());
    s.undo();
    expect(s.canRedo()).toBe(true);
    s.record(edit({ newText: 'Something else' }));
    expect(s.canRedo()).toBe(false);
  });

  it('returns null when there is nothing to undo or redo', () => {
    const s = createEditSession();
    expect(s.undo()).toBeNull();
    expect(s.redo()).toBeNull();
  });

  it('undoes an explicit removal', () => {
    const s = createEditSession();
    s.record(edit());
    s.remove(edit().key);
    expect(s.count()).toBe(0);
    s.undo();
    expect(s.count()).toBe(1);
  });
});

describe('multi-page sessions', () => {
  const other = edit({ key: 'src:Pricing.tsx:8:2', pageUrl: 'https://preview.test/pricing' });

  it('counts distinct pages', () => {
    const s = createEditSession();
    s.record(edit());
    s.record(other);
    expect(s.pageCount()).toBe(2);
  });

  it('lists edits made elsewhere', () => {
    const s = createEditSession();
    s.record(edit());
    s.record(other);
    expect(s.listOtherPages('https://preview.test/')).toHaveLength(1);
  });

  it('reports one page for a single-page session', () => {
    const s = createEditSession();
    s.record(edit());
    expect(s.pageCount()).toBe(1);
  });
});

describe('persistence', () => {
  it('round-trips through serialize and restore', () => {
    const a = createEditSession();
    a.record(edit());
    a.record(edit({ key: 'src:Nav.tsx:3:2', newText: 'Start' }));

    const b = createEditSession();
    expect(b.restore(a.serialize())).toBe(true);
    expect(b.count()).toBe(2);
    expect(b.get(edit().key).newText).toBe('Build things that matter');
  });

  it('does not restore history', () => {
    const a = createEditSession();
    a.record(edit());

    const b = createEditSession();
    b.restore(a.serialize());
    expect(b.canUndo()).toBe(false);
  });

  it('refuses a session from a future version', () => {
    const s = createEditSession();
    expect(s.restore({ version: SESSION_VERSION + 1, edits: [edit()] })).toBe(false);
  });

  it('refuses an expired session', () => {
    // A day-old set of edits should not be silently attached to a new PR.
    const s = createEditSession();
    const stale = { version: SESSION_VERSION, createdAt: 0, edits: [edit()] };
    expect(s.restore(stale, SESSION_MAX_AGE_MS + 1000)).toBe(false);
  });

  it('accepts a session inside the age limit', () => {
    const s = createEditSession();
    const recent = { version: SESSION_VERSION, createdAt: 1000, edits: [edit()] };
    expect(s.restore(recent, 1000 + SESSION_MAX_AGE_MS - 1)).toBe(true);
  });

  it('ignores empty or missing data', () => {
    const s = createEditSession();
    expect(s.restore(null)).toBe(false);
    expect(s.restore({ version: SESSION_VERSION, edits: [] })).toBe(false);
  });

  it('discards malformed entries', () => {
    const s = createEditSession();
    const ok = s.restore({
      version: SESSION_VERSION,
      createdAt: Date.now(),
      edits: [edit(), { key: 'x' }, null],
    });
    expect(ok).toBe(true);
    expect(s.count()).toBe(1);
  });
});

describe('payload', () => {
  it('emits only the fields the API needs', () => {
    const s = createEditSession();
    s.record(edit());
    const [payload] = s.toPayloadEdits();
    expect(payload).toEqual({
      framework: undefined,
      sourceFile: 'src/Hero.tsx',
      sourceLine: 12,
      originalText: 'Build things that mater',
      newText: 'Build things that matter',
      pageUrl: 'https://preview.test/',
    });
  });

  it('never leaks the raw untrimmed text to the server', () => {
    // originalRaw exists only to restore the DOM; the source file holds the
    // trimmed form, so sending it would break patching.
    const s = createEditSession();
    s.record(edit());
    expect(s.toPayloadEdits()[0]).not.toHaveProperty('originalRaw');
  });

  it('clears everything', () => {
    const s = createEditSession();
    s.record(edit());
    s.clear();
    expect(s.count()).toBe(0);
    expect(s.canUndo()).toBe(false);
  });
});
