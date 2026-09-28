"use strict";

// ============================================================
//  On-demand loader for the CodeMirror chunk
//
//  A content script cannot pull in an extension file with a
//  <script> tag — that would run in the page's world, not ours.
//  The background worker injects it with chrome.scripting into
//  the same isolated world, where it publishes its factory on a
//  global we can then read.
// ============================================================

const GLOBAL = "__IET_CODE_EDITOR__";

/** One in-flight load at a time; repeat callers await the same promise. */
let loading = null;

export function isLoaded() {
  return Boolean(globalThis[GLOBAL]);
}

/**
 * @returns {Promise<{mount: Function}>}
 * @throws if the chunk cannot be injected
 */
export function loadCodeEditor() {
  if (globalThis[GLOBAL]) return Promise.resolve(globalThis[GLOBAL]);
  if (loading) return loading;

  loading = (async () => {
    const response = await chrome.runtime.sendMessage({ type: "LOAD_CODE_EDITOR" });

    if (response?.error) {
      loading = null;
      throw new Error(response.error);
    }

    // executeScript resolves once the file has run, so the global is set —
    // but guard anyway rather than returning undefined to a caller.
    if (!globalThis[GLOBAL]) {
      loading = null;
      throw new Error("The code editor loaded but did not register itself.");
    }

    return globalThis[GLOBAL];
  })();

  return loading;
}
