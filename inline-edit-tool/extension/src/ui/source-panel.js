"use strict";

import { loadCodeEditor } from "../code-editor/loader.js";
import { countChangedLines } from "./diff.js";
import { resolveServiceUrl } from "../config.js";
import { getSessionId } from "../auth-storage.js";
import {
  stylesheetImports,
  isStylesheet,
  isPreprocessed,
  extractEmbeddedStyles,
  describeMissingStyles,
} from "../style-imports.js";

// ============================================================
//  Source panel
//
//  Opens the file an element came from, plus the stylesheets
//  that file imports — one tab each. The point is not that the
//  editor is in the browser; it is that clicking a rendered
//  heading lands on the line that produced it, and on the CSS
//  that styles it, without anyone searching for either.
// ============================================================

const P = "__iet";

/** Read the element's build annotation. */
export function sourceRefFor(el) {
  const file = el?.dataset?.editFile;
  if (!file) return null;

  const line = parseInt(el.dataset.editLine, 10);
  return {
    sourceFile: file,
    sourceLine: Number.isFinite(line) ? line : null,
  };
}

/**
 * @param {object} opts
 * @param {ShadowRoot} opts.root
 * @param {Element}    opts.element   the element that was clicked
 * @param {object}     opts.ctx       page context (repo / branch)
 * @param {object}     [opts.ref]     {sourceFile, sourceLine} when the file
 *                                    was resolved by search rather than by
 *                                    an annotation
 * @param {Function}   opts.onStage   called with an array of changed files
 * @param {Function}   opts.onPreview (path, change) as a file changes
 * @param {Function}   opts.onRevert  undo whatever onPreview applied
 * @param {Function}   opts.onClose
 */
export async function openSourcePanel({
  root,
  element,
  ctx,
  ref: refOverride,
  onStage,
  onPreview,
  onRevert,
  onClose,
}) {
  // An override comes from the Locate flow: text the build did not annotate,
  // whose file was found by searching the repository instead.
  const ref = refOverride || sourceRefFor(element);
  if (!ref) return null;

  // ── Shell ────────────────────────────────────────────────
  const backdrop = document.createElement("div");
  backdrop.id = `${P}-source-backdrop`;

  const panel = document.createElement("div");
  panel.id = `${P}-source-panel`;

  const header = document.createElement("div");
  header.className = `${P}-source-header`;

  const tabStrip = document.createElement("div");
  tabStrip.className = `${P}-source-tabs`;
  tabStrip.setAttribute("role", "tablist");

  const meta = document.createElement("span");
  meta.className = `${P}-source-meta`;

  const closeBtn = document.createElement("button");
  closeBtn.className = `${P}-source-close`;
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => close());

  header.append(tabStrip, meta, closeBtn);

  const body = document.createElement("div");
  body.className = `${P}-source-body`;

  const status = document.createElement("div");
  status.className = `${P}-source-status`;
  status.textContent = "Loading…";
  body.appendChild(status);

  const footer = document.createElement("div");
  footer.className = `${P}-source-footer`;

  const hint = document.createElement("span");
  hint.className = `${P}-source-hint`;

  const warn = document.createElement("span");
  warn.className = `${P}-source-warn`;
  warn.hidden = true;
  warn.textContent =
    "Compiled at build time \u2014 the page shows only the part the browser can run";

  const discardBtn = document.createElement("button");
  discardBtn.className = `${P}-source-btn`;
  discardBtn.type = "button";
  discardBtn.textContent = "Discard";
  discardBtn.addEventListener("click", () => close());

  const stageBtn = document.createElement("button");
  stageBtn.className = `${P}-source-btn ${P}-source-primary`;
  stageBtn.type = "button";
  stageBtn.textContent = "Stage change";
  stageBtn.disabled = true;

  footer.append(warn, hint, discardBtn, stageBtn);

  panel.append(header, body, footer);
  backdrop.appendChild(panel);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  root.appendChild(backdrop);

  /** @type {Array<{path, content, sha, origin, editor, pane, button}>} */
  const tabs = [];
  let codeEditor = null;
  let active = null;
  let staged = false;
  let previewTimer = null;
  const previousPadding = document.body.style.paddingBottom;

  function close() {
    clearTimeout(previewTimer);
    document.body.style.paddingBottom = previousPadding;
    // Anything the page picked up from the editor goes away with the panel
    // unless it was staged — a preview that outlived a Discard would be a
    // change nobody has a record of.
    if (!staged) onRevert?.();
    for (const tab of tabs) tab.editor?.destroy();
    backdrop.remove();
    onClose?.();
  }

  function fail(message) {
    status.textContent = message;
    status.dataset.tone = "error";
  }

  /**
   * Put the element in the strip of page the panel does not cover.
   *
   * Centring it in the viewport would hide it behind the panel — exactly the
   * element whose source is being edited, and the one whose live preview
   * there is any point in watching. Runs after the editor takes focus:
   * focusing a contenteditable scrolls it into view, which would otherwise
   * undo this immediately.
   */
  function revealTarget() {
    const panelHeight = panel.getBoundingClientRect().height;

    // Reserve the space the panel occupies, the way a docked devtools panel
    // does. Without it a short page is already scrolled to its end and simply
    // cannot lift an element out from behind the panel.
    document.body.style.paddingBottom = `${panelHeight}px`;

    const box = element.getBoundingClientRect();
    const visibleBand = window.innerHeight - panelHeight;
    window.scrollTo({
      top: window.scrollY + box.top - Math.max(16, (visibleBand - box.height) / 2),
      behavior: "smooth",
    });
  }

  const dirtyTabs = () => tabs.filter((t) => t.editor?.isDirty());

  /** Footer state and tab markers, from whatever is dirty right now. */
  function syncDirty() {
    const dirty = dirtyTabs();
    stageBtn.disabled = dirty.length === 0;

    for (const tab of tabs) {
      tab.button.classList.toggle(`${P}-tab-dirty`, Boolean(tab.editor?.isDirty()));
    }

    if (dirty.length === 0) hint.textContent = "";
    else if (dirty.length === 1) hint.textContent = "Unsaved changes";
    else hint.textContent = `Unsaved changes in ${dirty.length} files`;
  }

  /** Push one file's current contents onto the page, a beat after typing. */
  function schedulePreview(tab) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      if (!tab.editor || !onPreview) return;
      try {
        if (isStylesheet(tab.path)) {
          onPreview(tab.path, { kind: "style", css: tab.editor.getValue() });
          return;
        }

        onPreview(tab.path, { kind: "markup", outline: tab.editor.outline() });

        // A single-file component holds both, so its <style> block has to be
        // previewed as well as its template.
        const embedded = extractEmbeddedStyles(tab.editor.getValue());
        if (embedded) onPreview(`${tab.path}#style`, { kind: "style", css: embedded.css });
      } catch {
        // A half-typed rule or tag does not parse. Leave the page as it was
        // and wait for the next keystroke rather than showing it broken.
      }
    }, 180);
  }

  function updateMeta() {
    if (!active?.editor) {
      meta.textContent = "";
      warn.hidden = true;
      return;
    }
    meta.textContent = active.origin
      ? `line ${active.origin} of ${active.editor.lineCount()}`
      : `${active.editor.lineCount()} lines`;

    // The browser runs CSS, not SCSS, and cannot scope a component's styles
    // the way its compiler will. Saying so is the difference between a partial
    // preview and a wrong one.
    const scoped = extractEmbeddedStyles(active.content || "")?.scoped;

    if (isPreprocessed(active.path)) {
      warn.textContent =
        "Compiled at build time \u2014 the page shows only the part the browser can run";
      warn.hidden = false;
    } else if (scoped) {
      warn.textContent = "Scoped styles preview unscoped";
      warn.hidden = false;
    } else {
      warn.hidden = true;
    }
  }

  /** Editors are built on first view: an unopened tab costs nothing. */
  function activate(tab) {
    if (active === tab) return;

    for (const other of tabs) {
      other.pane.hidden = other !== tab;
      other.button.setAttribute("aria-selected", String(other === tab));
    }
    active = tab;

    if (!tab.editor && tab.content !== null) {
      tab.editor = codeEditor.mount({
        parent: tab.pane,
        root,
        doc: tab.content,
        filePath: tab.path,
        originLine: tab.origin,
        originEndLine: tab.origin,
        onChange: () => {
          syncDirty();
          schedulePreview(tab);
        },
        onSave: () => stage(),
        onCancel: () => close(),
      });
    }

    updateMeta();
    tab.editor?.focus();
  }

  function addTab({ path, label, content, sha, origin, note }) {
    const button = document.createElement("button");
    button.className = `${P}-source-tab`;
    button.type = "button";
    button.setAttribute("role", "tab");
    button.dataset.path = path;
    button.textContent = label || path.split("/").pop();
    button.title = path;

    const pane = document.createElement("div");
    pane.className = `${P}-source-editor`;
    pane.hidden = true;

    const tab = { path, content: content ?? null, sha, origin, editor: null, pane, button };

    // A tab with nothing behind it still exists, and says why.
    if (note) {
      pane.classList.add(`${P}-source-note`);

      const title = document.createElement("strong");
      title.textContent = note.title;

      const detail = document.createElement("p");
      detail.textContent = note.detail;
      pane.append(title, detail);

      if (note.classes?.length) {
        const list = document.createElement("div");
        list.className = `${P}-source-note-classes`;
        for (const name of note.classes) {
          const chip = document.createElement("code");
          chip.textContent = name;
          list.appendChild(chip);
        }
        pane.appendChild(list);
      }
    }

    button.addEventListener("click", () => activate(tab));
    tabStrip.appendChild(button);
    body.appendChild(pane);
    tabs.push(tab);
    return tab;
  }

  /** Stage every file that changed, each as its own whole-file edit. */
  function stage() {
    const dirty = dirtyTabs();
    if (dirty.length === 0) return;

    staged = true;
    onStage?.(
      dirty.map((tab) => ({
        sourceFile: tab.path,
        content: tab.editor.getValue(),
        baseSha: tab.sha,
        sourceLine: tab.origin,
        linesChanged: countChangedLines(tab.content, tab.editor.getValue()),
      }))
    );
    close();
  }

  stageBtn.addEventListener("click", stage);

  // ── Fetch the files and the editor ───────────────────────
  try {
    const stored = await chrome.storage.sync.get(["prServiceUrl"]);
    const token = (await getSessionId()) || "";
    const serviceUrl = resolveServiceUrl(stored.prServiceUrl);

    if (!ctx.repo || !ctx.branch) {
      fail(
        "This page does not say which repository it was built from, so the file cannot be fetched."
      );
      return { close };
    }

    const fetchFile = (path) =>
      chrome.runtime.sendMessage({
        type: "API_FETCH",
        payload: {
          path:
            `/api/file?repo=${encodeURIComponent(ctx.repo)}` +
            `&branch=${encodeURIComponent(ctx.branch)}` +
            `&path=${encodeURIComponent(path)}`,
          token,
          serviceUrl,
        },
      });

    status.textContent = "Fetching file…";

    // The chunk is the largest thing shipped; start it downloading alongside
    // the fetch rather than after it.
    const [fileResponse, editorModule] = await Promise.all([
      fetchFile(ref.sourceFile),
      loadCodeEditor(),
    ]);
    codeEditor = editorModule;

    if (fileResponse?.error) {
      fail(fileResponse.error);
      return { close };
    }

    const { content, sha } = fileResponse.data;
    status.remove();

    addTab({ path: ref.sourceFile, content, sha, origin: ref.sourceLine });

    // ── Stylesheets the component brings in ────────────────
    const stylePaths = stylesheetImports(content, ref.sourceFile);

    if (stylePaths.length === 0) {
      addTab({
        path: "styles",
        label: "Styles",
        content: null,
        note: describeMissingStyles(element, ref.sourceFile, content),
      });
    } else {
      // Fetched together: a component rarely imports more than one or two,
      // and a tab that is still loading when clicked reads as broken.
      const responses = await Promise.all(stylePaths.map(fetchFile));

      responses.forEach((response, i) => {
        const path = stylePaths[i];

        if (response?.error || !response?.data) {
          addTab({
            path,
            content: null,
            note: {
              title: "Could not open this stylesheet",
              detail:
                `${ref.sourceFile.split("/").pop()} imports ${path}, but it could not be read ` +
                `from the branch this page was built from. ${response?.error || ""}`.trim(),
            },
          });
          return;
        }

        addTab({ path, content: response.data.content, sha: response.data.sha });
      });
    }

    activate(tabs[0]);
    syncDirty();
    revealTarget();
  } catch (err) {
    fail(err.message);
  }

  return { close };
}
