"use strict";

// ============================================================
//  Edit session
//
//  Holds pending edits, an undo/redo history, and the logic for
//  persisting both across navigation. Deliberately free of DOM
//  and chrome.* access: edits are keyed by a stable string so a
//  framework re-render (or a page load) cannot orphan them the
//  way a live element reference would.
// ============================================================

export const SESSION_VERSION = 1;

/** Edits older than this are dropped on restore rather than silently resubmitted. */
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {object} Edit
 * @property {string}  key           stable element identity
 * @property {string}  pageUrl       where the edit was made
 * @property {string}  [framework]
 * @property {string}  [sourceFile]
 * @property {number}  [sourceLine]
 * @property {string}  originalText  trimmed — what the source file contains
 * @property {string}  originalRaw   exact rendered text, for restoring the DOM
 * @property {string}  newText
 */

export function createEditSession() {
  /** @type {Edit[]} — insertion ordered */
  let edits = [];
  /** @type {{key: string, before: Edit|null, after: Edit|null}[]} */
  let undoStack = [];
  let redoStack = [];
  let createdAt = Date.now();

  const find = (key) => edits.find((e) => e.key === key) || null;

  /** Apply a before/after transition without touching history. */
  function put(key, edit) {
    const index = edits.findIndex((e) => e.key === key);
    if (edit === null) {
      if (index !== -1) edits.splice(index, 1);
    } else if (index === -1) {
      edits.push(edit);
    } else {
      edits[index] = edit;
    }
  }

  return {
    /**
     * Record a change to one element.
     *
     * Re-editing an element keeps the *first* original text, so the patch
     * always describes the round trip from what is in the source file to
     * what the editor finally wants. Typing a value back to its original
     * drops the edit entirely.
     *
     * @returns {{changed: boolean, edit: Edit|null}}
     */
    record(input) {
      const { key, newText } = input;
      if (!key) throw new Error("record requires a key");

      const existing = find(key);
      const originalText = existing ? existing.originalText : input.originalText;
      const originalRaw = existing ? existing.originalRaw : input.originalRaw;

      if (newText === originalText) {
        // Back to where it started — remove rather than store a no-op.
        if (!existing) return { changed: false, edit: null };
        undoStack.push({ key, before: existing, after: null });
        redoStack = [];
        put(key, null);
        return { changed: true, edit: null };
      }

      if (existing && existing.newText === newText) {
        return { changed: false, edit: existing };
      }

      const next = { ...input, originalText, originalRaw };
      undoStack.push({ key, before: existing, after: next });
      redoStack = [];
      put(key, next);
      return { changed: true, edit: next };
    },

    /**
     * Attach a source location the editor confirmed for an unannotated edit.
     * Not a history step: it records where the text lives, not what it says.
     */
    attachSource(key, { sourceFile, sourceLine }) {
      const existing = find(key);
      if (!existing) return false;
      put(key, { ...existing, sourceFile, sourceLine, sourceFileConfirmed: true });
      return true;
    },

    /** Drop an edit and record it in history. */
    remove(key) {
      const existing = find(key);
      if (!existing) return false;
      undoStack.push({ key, before: existing, after: null });
      redoStack = [];
      put(key, null);
      return true;
    },

    /**
     * Step back one change.
     * @returns {{key: string, edit: Edit|null}|null} the state to render, or null
     */
    undo() {
      const entry = undoStack.pop();
      if (!entry) return null;
      redoStack.push(entry);
      put(entry.key, entry.before);
      return { key: entry.key, edit: entry.before };
    },

    /** Step forward one change. */
    redo() {
      const entry = redoStack.pop();
      if (!entry) return null;
      undoStack.push(entry);
      put(entry.key, entry.after);
      return { key: entry.key, edit: entry.after };
    },

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,

    get: (key) => find(key),
    has: (key) => find(key) !== null,
    list: () => edits.slice(),
    count: () => edits.length,
    keys: () => edits.map((e) => e.key),

    /** Edits made on a page other than the given URL. */
    listOtherPages: (pageUrl) => edits.filter((e) => e.pageUrl !== pageUrl),

    /** How many distinct pages this session spans. */
    pageCount: () => new Set(edits.map((e) => e.pageUrl)).size,

    clear() {
      edits = [];
      undoStack = [];
      redoStack = [];
      createdAt = Date.now();
    },

    /** Plain object for chrome.storage. History is intentionally not persisted. */
    serialize: () => ({ version: SESSION_VERSION, createdAt, edits: edits.slice() }),

    /**
     * Load a persisted session, ignoring anything unusable.
     * @returns {boolean} whether anything was restored
     */
    restore(data, now = Date.now()) {
      if (!data || data.version !== SESSION_VERSION) return false;
      if (!Array.isArray(data.edits) || data.edits.length === 0) return false;

      // Compare on type, not truthiness: a createdAt of 0 is an ancient
      // session, and treating it as "absent" would skip the age check.
      const stamp = typeof data.createdAt === "number" ? data.createdAt : now;
      if (now - stamp > SESSION_MAX_AGE_MS) return false;

      edits = data.edits.filter(
        (e) => e && typeof e.key === "string" && typeof e.newText === "string"
      );
      undoStack = [];
      redoStack = [];
      createdAt = stamp;
      return edits.length > 0;
    },

    /** The wire format for /api/create-pr. */
    toPayloadEdits: () =>
      edits.map(
        ({
          framework,
          sourceFile,
          sourceLine,
          sourceColumn,
          sourceFileConfirmed,
          i18nKey,
          attribute,
          op,
          moveBy,
          upload,
          kind,
          fileContent,
          baseSha,
          originalText,
          newText,
          pageUrl,
        }) => ({
          framework,
          sourceFile,
          sourceLine,
          sourceColumn,
          sourceFileConfirmed,
          i18nKey,
          attribute,
          op,
          moveBy,
          upload,
          kind,
          fileContent,
          baseSha,
          originalText,
          newText,
          pageUrl,
        })
      ),
  };
}
