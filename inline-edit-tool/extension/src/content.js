"use strict";

// ============================================================
//  Inline Edit Tool — content script
//
//  Orchestrates the shadow-root UI, the element registry and
//  the edit session.
//
//  Interaction is tool-based: the rail holds one active tool at
//  a time, and that tool decides what clicking the page does.
//  Nothing is decorated until a tool is picked, so the page is
//  untouched while the toolbar merely sits there.
// ============================================================

import { resolvePageContext } from "./page-context.js";
import { getShadowRoot, isOwnUi } from "./shadow-host.js";
import { createEditSession } from "./edit-session.js";
import { openEditorOverlay } from "./editor-overlay.js";
import { openSubmitPanel } from "./submit-panel.js";
import { createRail, createToast, TOOL } from "./ui/rail.js";
import { createLabelLayer, createInspectorCard } from "./ui/labels.js";
import { createGuideLayer } from "./ui/guides.js";
import {
  EDITABLE_SELECTOR,
  editKey,
  findEditableElements,
  editableAncestors,
  describeElement,
  observeDom,
} from "./element-registry.js";

const P = "__iet";

const CLS = {
  editable: `${P}-editable`,
  hovered: `${P}-hovered`,
  editing: `${P}-editing`,
  dirty: `${P}-dirty`,
};

const SESSION_STORAGE_KEY = "editSession";
const SIDE_STORAGE_KEY = "railSide";
const GUIDES_STORAGE_KEY = "guidesEnabled";

// ---- State -------------------------------------------------
const session = createEditSession();

let root = null;
let rail = null;
let toast = null;
let labels = null;
let inspector = null;
let guides = null;
let crumbsEl = null;

let activeTool = null;
let autoDetectMode = false;
let editableEls = [];
let activeOverlay = null;
let activeTarget = null;
let hoveredEl = null;
let observer = null;
let panel = null;

/** Tools that need the page decorated and click-interactive. */
const INTERACTIVE_TOOLS = new Set([TOOL.INSPECT, TOOL.EDIT]);

// ============================================================
//  Session persistence
//
//  Edits live in chrome.storage.local so an editor can walk
//  several pages of a preview and submit them as one PR.
// ============================================================
async function persistSession() {
  if (session.count() === 0) {
    await chrome.storage.local.remove(SESSION_STORAGE_KEY);
    return;
  }
  await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session.serialize() });
}

async function restoreSession() {
  const stored = await chrome.storage.local.get([SESSION_STORAGE_KEY]);
  if (!session.restore(stored[SESSION_STORAGE_KEY])) return;

  syncRail();
  const pages = session.pageCount();
  if (pages > 1) {
    toast.show(`${session.count()} edits pending across ${pages} pages`, { tone: "info" });
  }
}

// ============================================================
//  UI construction
// ============================================================
function buildUi() {
  root = getShadowRoot();

  rail = createRail({ onTool: selectTool, onAction: runAction, onToggle: setToggleOption });
  toast = createToast();
  labels = createLabelLayer();
  inspector = createInspectorCard();
  guides = createGuideLayer();

  crumbsEl = document.createElement("div");
  crumbsEl.id = `${P}-crumbs`;
  crumbsEl.hidden = true;

  root.append(
    rail.element,
    guides.element,
    labels.element,
    inspector.element,
    crumbsEl,
    toast.element
  );

  rail.setSide("left");
  syncRail();
}

/** Rail side and view options, remembered across pages. */
async function restorePreferences() {
  const stored = await chrome.storage.sync.get([SIDE_STORAGE_KEY, GUIDES_STORAGE_KEY]);
  rail.setSide(stored[SIDE_STORAGE_KEY] || "left");

  // Guides are on unless explicitly turned off.
  const guidesOn = stored[GUIDES_STORAGE_KEY] !== false;
  guides.setEnabled(guidesOn);
  rail.setToggle("guides", guidesOn);
}

function setToggleOption(id, on) {
  if (id !== "guides") return;
  guides.setEnabled(on);
  chrome.storage.sync.set({ [GUIDES_STORAGE_KEY]: on });
  if (on && hoveredEl?.isConnected) {
    guides.show(hoveredEl, session.has(editKey(hoveredEl)) ? "edited" : "hover");
  }
}

function flipSide() {
  const next = rail.side === "left" ? "right" : "left";
  rail.setSide(next);
  chrome.storage.sync.set({ [SIDE_STORAGE_KEY]: next });
  if (hoveredEl?.isConnected) labels.reposition(hoveredEl);
}

function syncRail() {
  rail.setCount(session.count());
  rail.setHistory({ canUndo: session.canUndo(), canRedo: session.canRedo() });
}

function setRailVisible(visible) {
  if (!rail) return;
  if (visible) rail.show();
  else {
    rail.hide(); // also deselects the active tool, which tears down decorations
    teardownInteraction();
  }
}

// ============================================================
//  Tools
// ============================================================
function selectTool(toolId) {
  const wasInteractive = INTERACTIVE_TOOLS.has(activeTool);
  activeTool = toolId;

  inspector.hide();
  labels.hide();
  guides.hide();
  hideCrumbs();

  if (INTERACTIVE_TOOLS.has(toolId)) {
    if (!wasInteractive) setupInteraction();
    else scanAndDecorate();

    toast.show(
      toolId === TOOL.EDIT
        ? "Click any highlighted text to rewrite it"
        : "Hover to see where text comes from; click for detail",
      { tone: "info" }
    );
  } else if (wasInteractive) {
    teardownInteraction();
  }
}

function runAction(id) {
  switch (id) {
    case "undo":
      undo();
      break;
    case "redo":
      redo();
      break;
    case "changes":
    case "submit":
      showSubmitPanel();
      break;
    case "flip":
      flipSide();
      break;
    case "close":
      setRailVisible(false);
      break;
  }
}

// ============================================================
//  Page interaction
// ============================================================
function setupInteraction() {
  scanAndDecorate();

  // One delegated listener rather than one per element. Resolving upwards
  // from event.target means the innermost editable element wins — with
  // per-element capture listeners an outer <div> swallowed clicks intended
  // for a <span> inside it.
  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("mouseover", onDocumentHover, true);
  document.addEventListener("mouseout", onDocumentUnhover, true);
  window.addEventListener("scroll", onViewportChange, true);
  window.addEventListener("resize", onViewportChange);

  // Frameworks replace nodes on re-render; without this the decorations,
  // listeners and edited text would all silently disappear.
  observer = observeDom(document.body, onDomChanged);
}

function teardownInteraction() {
  cancelActiveEditor();

  document.removeEventListener("click", onDocumentClick, true);
  document.removeEventListener("mouseover", onDocumentHover, true);
  document.removeEventListener("mouseout", onDocumentUnhover, true);
  window.removeEventListener("scroll", onViewportChange, true);
  window.removeEventListener("resize", onViewportChange);

  observer?.disconnect();
  observer = null;

  undecorate();
  labels.hide();
  guides.hide();
  inspector.hide();
  hideCrumbs();

  autoDetectMode = false;
  editableEls = [];
  hoveredEl = null;
}

/** Find editable elements, decorate them, and re-apply pending edits. */
function scanAndDecorate() {
  const { elements, autoDetected } = findEditableElements(document, isOwnUi);
  editableEls = elements;
  autoDetectMode = autoDetected;

  if (autoDetected) {
    elements.forEach((el) => {
      el.dataset.editable = "true";
      el.dataset.autoDetected = "true";
      el.dataset.editFramework = "auto";
    });
  }

  for (const el of elements) el.classList.add(CLS.editable);

  reapplyPendingEdits();
}

function undecorate() {
  for (const el of document.querySelectorAll(`.${CLS.editable}`)) {
    el.classList.remove(CLS.editable, CLS.hovered, CLS.editing);
    if (el.dataset.autoDetected) {
      delete el.dataset.editable;
      delete el.dataset.autoDetected;
      delete el.dataset.editFramework;
    }
  }
}

/**
 * Put edited text back into the DOM.
 *
 * A re-render restores each element's text from the framework's own state,
 * which would otherwise make the editor's changes appear to vanish.
 */
function reapplyPendingEdits() {
  if (session.count() === 0) return;

  observer?.pause();
  for (const el of editableEls) {
    const edit = session.get(editKey(el));
    if (!edit) continue;
    if (el.innerText.trim() !== edit.newText) el.innerText = edit.newText;
    el.classList.add(CLS.dirty);
  }
  observer?.resume();
}

function onDomChanged() {
  if (!INTERACTIVE_TOOLS.has(activeTool)) return;
  // A full rescan is cheap next to a framework re-render, and avoids having
  // to work out which specific nodes were swapped.
  scanAndDecorate();
  if (activeTarget && !activeTarget.isConnected) cancelActiveEditor();
  else activeOverlay?.reposition();
}

function onViewportChange() {
  const anchor = activeTarget?.isConnected ? activeTarget : hoveredEl;
  if (anchor?.isConnected) {
    labels.reposition(anchor);
    guides.reposition(anchor);
  } else {
    labels.hide();
    guides.hide();
  }
  if (crumbsEl.hidden === false && hoveredEl) positionCrumbs(hoveredEl);
}

// ---- Hover -------------------------------------------------
function editableFrom(target) {
  if (!target?.closest || isOwnUi(target)) return null;
  return target.closest(`.${CLS.editable}`);
}

function onDocumentHover(e) {
  const el = editableFrom(e.target);
  if (!el || el === hoveredEl) return;

  if (hoveredEl) hoveredEl.classList.remove(CLS.hovered);
  hoveredEl = el;
  el.classList.add(CLS.hovered);

  const state = session.has(editKey(el)) ? "edited" : "hover";
  labels.show(el, { state });
  guides.show(el, state);
  showCrumbs(el);
}

function onDocumentUnhover(e) {
  const el = editableFrom(e.target);
  if (!el) return;

  // The editing overlay sits on top of its target, which fires a mouseout on
  // the element underneath. Keep the label up: knowing which file you are
  // editing matters most while you are typing into it.
  if (el === activeTarget) return;

  el.classList.remove(CLS.hovered);
  if (el === hoveredEl) {
    hoveredEl = null;
    labels.hide();
    guides.hide();
  }
}

/**
 * Show the chain of editable ancestors, so a parent is still reachable when
 * the pointer lands on a nested child.
 */
function showCrumbs(el) {
  const chain = editableAncestors(el, (n) => n.classList?.contains(CLS.editable));
  if (chain.length < 2) {
    hideCrumbs();
    return;
  }

  crumbsEl.textContent = "";
  chain.forEach((node, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = `${P}-crumb-sep`;
      sep.textContent = "›";
      crumbsEl.appendChild(sep);
    }
    const crumb = document.createElement("button");
    crumb.className = `${P}-crumb`;
    crumb.type = "button";
    crumb.textContent = describeElement(node);
    crumb.addEventListener("click", (e) => {
      e.stopPropagation();
      activateOn(node);
    });
    crumbsEl.appendChild(crumb);
  });

  crumbsEl.hidden = false;
  positionCrumbs(el);
}

function positionCrumbs(el) {
  const rect = el.getBoundingClientRect();
  // Sit below the element: the label already occupies the space above it.
  const railGutter = 66;
  const maxLeft = window.innerWidth - crumbsEl.offsetWidth - (rail.side === "right" ? railGutter : 8);
  crumbsEl.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 34)}px`;
  crumbsEl.style.left = `${Math.max(rail.side === "left" ? railGutter : 8, Math.min(rect.left, maxLeft))}px`;
}

function hideCrumbs() {
  if (crumbsEl) crumbsEl.hidden = true;
}

// ============================================================
//  Click → whatever the active tool does
// ============================================================
function onDocumentClick(e) {
  const el = editableFrom(e.target);
  if (!el) {
    inspector.hide();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  activateOn(el);
}

function activateOn(el) {
  if (activeTool === TOOL.INSPECT) {
    inspector.show(el);
    labels.show(el, { state: "selected" });
    guides.show(el, "selected");
    return;
  }
  if (activeTool === TOOL.EDIT) beginEdit(el);
}

// ============================================================
//  Editing
// ============================================================
function beginEdit(el) {
  if (activeTarget === el) return;
  cancelActiveEditor();

  activeTarget = el;
  el.classList.add(CLS.editing);
  el.classList.remove(CLS.hovered);
  labels.show(el, { state: "selected" });
  guides.show(el, "selected");
  hideCrumbs();

  activeOverlay = openEditorOverlay(el, root, {
    onCommit: (text) => commitEdit(el, text),
    onCancel: () => finishEditing(el),
  });
}

function finishEditing(el) {
  el.classList.remove(CLS.editing);
  labels.hide();
  guides.hide();
  if (activeTarget === el) {
    activeTarget = null;
    activeOverlay = null;
  }
}

function commitEdit(el, rawText) {
  const newText = rawText.trim();
  const originalRaw = el.innerText;
  const key = editKey(el);

  const { changed } = session.record({
    key,
    pageUrl: window.location.href,
    framework: el.dataset.editFramework,
    sourceFile: el.dataset.editFile,
    sourceLine: el.dataset.editLine ? parseInt(el.dataset.editLine, 10) : undefined,
    // Present when the text comes from a translation call; the service
    // redirects the patch to the locale file rather than the component.
    i18nKey: el.dataset.editI18nKey,
    originalText: originalRaw.trim(),
    originalRaw,
    newText,
  });

  finishEditing(el);
  if (!changed) return;

  const edit = session.get(key);
  if (edit) renderEdit(el, edit);
  else restoreOriginal(el, originalRaw);

  syncRail();
  persistSession();

  const n = session.count();
  toast.show(
    n === 0 ? "Back to the original" : `${n} edit${n === 1 ? "" : "s"} ready to submit`,
    { tone: n === 0 ? "info" : "done" }
  );
}

/** Write an edit's text into the page and mark the element. */
function renderEdit(el, edit) {
  observer?.pause();
  el.innerText = edit.newText;
  el.classList.add(CLS.dirty);
  observer?.resume();
}

function restoreOriginal(el, raw) {
  observer?.pause();
  if (raw !== undefined) el.innerText = raw;
  el.classList.remove(CLS.dirty);
  observer?.resume();
}

function cancelActiveEditor() {
  if (!activeOverlay) return;
  const el = activeTarget;
  activeOverlay.destroy();
  activeOverlay = null;
  activeTarget = null;
  el?.classList.remove(CLS.editing);
}

/** Locate the live element for a key, if it is on this page. */
function elementForKey(key) {
  const candidates = editableEls.length
    ? editableEls
    : Array.from(document.querySelectorAll(EDITABLE_SELECTOR));
  return candidates.find((el) => editKey(el) === key) || null;
}

// ============================================================
//  Undo / redo
// ============================================================
/**
 * Render one history step.
 *
 * `step.edit` is the state to move to: an edit to re-apply, or null meaning
 * the element goes back to its original text. `previous` carries the raw
 * text in that second case, since the session no longer holds the entry.
 */
function applyHistoryStep(step, previous) {
  if (!step) return;

  const el = elementForKey(step.key);
  if (el) {
    if (step.edit) renderEdit(el, step.edit);
    else restoreOriginal(el, previous?.originalRaw);
  }

  syncRail();
  persistSession();
}

function undo() {
  // Capture the outgoing edit before the session drops it — its originalRaw
  // is what the element has to be restored to.
  const outgoing = session.list();
  const step = session.undo();
  if (!step) return;
  applyHistoryStep(step, outgoing.find((e) => e.key === step.key));
  toast.show("Undone", { tone: "info", duration: 1400 });
}

function redo() {
  const outgoing = session.list();
  const step = session.redo();
  if (!step) return;
  applyHistoryStep(step, outgoing.find((e) => e.key === step.key));
  toast.show("Redone", { tone: "info", duration: 1400 });
}

function onKeydown(e) {
  if (!rail?.visible) return;

  if (e.key === "Escape" && inspector.visible) {
    inspector.hide();
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }

  // Single-key tool switching, but never while typing.
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  // An open editor takes every plain keystroke — otherwise typing "edit"
  // would switch tools halfway through the word.
  if (activeOverlay) return;

  // e.target is retargeted to the shadow host for events inside the shadow
  // root, so ask composedPath for the node actually focused.
  const target = e.composedPath?.()[0] || e.target;
  if (
    target?.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || "")
  ) {
    return;
  }

  if (e.key === "i") rail.selectTool(activeTool === TOOL.INSPECT ? null : TOOL.INSPECT);
  if (e.key === "e") rail.selectTool(activeTool === TOOL.EDIT ? null : TOOL.EDIT);
}

// ============================================================
//  Submit
// ============================================================
async function showSubmitPanel() {
  if (panel || session.count() === 0) return;
  cancelActiveEditor();

  panel = await openSubmitPanel({
    root,
    session,
    ctx: resolvePageContext({
      dataset: document.documentElement.dataset,
      hostname: window.location.hostname,
    }),
    onOpen: () => {
      toast.hide();
      labels.hide();
      guides.hide();
      hideCrumbs();
    },
    onClose: () => {
      panel = null;
    },
    onSubmitted: async () => {
      for (const key of session.keys()) {
        elementForKey(key)?.classList.remove(CLS.dirty);
      }
      session.clear();
      await persistSession();
      syncRail();
      toast.show("Pull request opened", { tone: "done", duration: 5000 });
    },
  });
}

// ============================================================
//  Popup / side-panel bridge
// ============================================================
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case "TOGGLE_TOOLBAR": {
      const nowVisible = !rail.visible;
      setRailVisible(nowVisible);
      sendResponse({ visible: nowVisible });
      return false;
    }

    case "GET_TOOLBAR_STATE":
      sendResponse({ visible: Boolean(rail?.visible) });
      return false;

    case "GET_EDIT_STATE":
      sendResponse(editState());
      return false;

    case "SET_EDIT_MODE":
      if (message.enabled) {
        setRailVisible(true);
        rail.selectTool(TOOL.EDIT);
      } else {
        rail.selectTool(null);
      }
      sendResponse(editState());
      return false;

    case "SET_TOOL":
      setRailVisible(true);
      rail.selectTool(message.tool ?? null);
      sendResponse(editState());
      return false;

    case "UNDO":
      undo();
      sendResponse(editState());
      return false;

    case "REDO":
      redo();
      sendResponse(editState());
      return false;

    case "OPEN_SUBMIT_PANEL":
      showSubmitPanel();
      sendResponse({ ok: true });
      return false;

    // The side panel edited the stored session directly.
    case "SESSION_REPLACED":
      syncFromStorage();
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});

function editState() {
  return {
    // Kept for the side panel and the existing message contract: "edit mode"
    // now means the Edit tool specifically.
    editMode: activeTool === TOOL.EDIT,
    tool: activeTool,
    visible: Boolean(rail?.visible),
    canUndo: session.canUndo(),
    canRedo: session.canRedo(),
    count: session.count(),
  };
}

/**
 * Reload the session from storage after the side panel changed it, and bring
 * the page back in line — elements whose edit was discarded get their
 * original text back.
 */
async function syncFromStorage() {
  const before = new Map(session.list().map((e) => [e.key, e]));

  const stored = await chrome.storage.local.get([SESSION_STORAGE_KEY]);
  session.clear();
  session.restore(stored[SESSION_STORAGE_KEY]);

  for (const [key, edit] of before) {
    if (session.has(key)) continue;
    const element = elementForKey(key);
    if (element) restoreOriginal(element, edit.originalRaw);
  }

  if (INTERACTIVE_TOOLS.has(activeTool)) reapplyPendingEdits();
  syncRail();
}

// ============================================================
//  Init
// ============================================================
async function init() {
  buildUi();
  await restorePreferences();
  document.addEventListener("keydown", onKeydown, true);
  await restoreSession();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
