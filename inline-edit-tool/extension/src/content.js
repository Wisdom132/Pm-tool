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
import { editingParams, resolveSite } from "./site-resolver.js";
import { annotationFor, commentTargetFrom, selectorFor } from "./element-selector.js";
import { openCommentComposer } from "./ui/comment-composer.js";
import { resolveServiceUrl } from "./config.js";
import { getSessionId } from "./auth-storage.js";
import { getShadowHost, getShadowRoot, isOwnUi } from "./shadow-host.js";
import { captureViewport } from "./screenshot.js";
import { createEditSession } from "./edit-session.js";
import { openEditorOverlay } from "./editor-overlay.js";
import { openSubmitPanel } from "./submit-panel.js";
import { createRail, createToast, TOOL } from "./ui/rail.js";
import { createLabelLayer, createInspectorCard } from "./ui/labels.js";
import { createGuideLayer } from "./ui/guides.js";
import { createToolCard } from "./ui/tool-card.js";
import { createA11yCard } from "./ui/a11y.js";
import { createSearchPanel } from "./ui/search.js";
import { createPropertiesPanel } from "./ui/properties.js";
import { createStructureBar } from "./ui/structure-bar.js";
import { openSourcePanel, sourceRefFor } from "./ui/source-panel.js";
import { openSourcePicker } from "./ui/source-picker.js";
import { BREAKPOINTS, activeBreakpoint, windowSizeFor } from "./ui/viewport.js";
import {
  EDITABLE_SELECTOR,
  editKey,
  elementForDomPath,
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
  removed: `${P}-removed`,
};

const SESSION_STORAGE_KEY = "editSession";

/**
 * Responsive-image attributes parked while a replacement is previewed.
 *
 * Setting `src` alone is not a preview on any page using srcset — the
 * browser keeps choosing from the candidate set and the swap looks like it
 * did nothing. The originals are kept here, off the page's own markup, so
 * undo can put them back exactly.
 */
const stashedResponsive = new WeakMap();

/** chrome.storage.local has a finite quota, and a PR is not a CDN. */
const MAX_IMAGE_BYTES = 512 * 1024;
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
let properties = null;
let structureBar = null;
let sourcePanel = null;
let crumbsEl = null;

let activeTool = null;
/** Inspect's pinned element — the fixed end of a measurement. */
let pinnedEl = null;
let toolCard = null;
let a11yCard = null;
let search = null;
let autoDetectMode = false;
let editableEls = [];
let activeOverlay = null;
let activeTarget = null;
let hoveredEl = null;
let observer = null;
let panel = null;

/** Tools that need the page decorated and click-interactive. */
const INTERACTIVE_TOOLS = new Set([
  TOOL.INSPECT,
  TOOL.A11Y,
  TOOL.EDIT,
  TOOL.PROPERTIES,
  TOOL.STRUCTURE,
  TOOL.COMMENT,
]);

/**
 * Tools that act on anything on the page rather than only what the codemod
 * can edit.
 *
 * The registry's rule — annotated elements, plus anything holding direct
 * text — is right for **Edit** alone: it rewrites copy, and offering an
 * edit that fails at commit time is worse than not offering it.
 *
 * Every other tool belongs here, and each was silently inert somewhere
 * until it was added:
 *
 * - **Inspect** and **Comment** describe or discuss; you inspect an image
 *   to find out which component drew it, and you comment on whatever you
 *   can see. Both were dead on images, icons and empty buttons.
 * - **Properties** promises "links, alt text and classes" — and alt text
 *   lives on an image, the one kind of element the text-bearing rule can
 *   never match. The tool's headline feature was unreachable.
 * - **Structure** moves, duplicates and deletes elements; a card or a
 *   figure is exactly what gets rearranged, and neither holds direct text.
 */
const WHOLE_PAGE_TOOLS = new Set([
  TOOL.COMMENT,
  TOOL.INSPECT,
  TOOL.A11Y,
  TOOL.PROPERTIES,
  TOOL.STRUCTURE,
]);

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
  toolCard = createToolCard();
  a11yCard = createA11yCard();
  search = createSearchPanel({
    onPick: (el) => activateOn(el),
    onHighlight: highlightFromSearch,
    isExcluded: isOwnUi,
  });
  properties = createPropertiesPanel({
    root,
    onChange: recordAttributeEdit,
    onPickImage: pickImage,
  });
  structureBar = createStructureBar({ onOp: recordStructuralEdit });

  crumbsEl = document.createElement("div");
  crumbsEl.id = `${P}-crumbs`;
  crumbsEl.hidden = true;

  root.append(
    rail.element,
    guides.element,
    properties.element,
    structureBar.element,
    labels.element,
    inspector.element,
    crumbsEl,
    a11yCard.element,
    search.element,
    toolCard.element,
    toast.element
  );

  rail.setSide("left");
  toolCard.setSide("left");
  search.setSide("left");
  syncRail();
}

/** Rail side and view options, remembered across pages. */
async function restorePreferences() {
  const stored = await chrome.storage.sync.get([SIDE_STORAGE_KEY, GUIDES_STORAGE_KEY]);
  rail.setSide(stored[SIDE_STORAGE_KEY] || "left");
  toolCard.setSide(stored[SIDE_STORAGE_KEY] || "left");
  search.setSide(stored[SIDE_STORAGE_KEY] || "left");

  // Guides are on unless explicitly turned off.
  const guidesOn = stored[GUIDES_STORAGE_KEY] !== false;
  guides.setEnabled(guidesOn);
  // Reflect the stored state without announcing it — nothing just changed.
  rail.setToggle("guides", guidesOn, { silent: true });
}

function setToggleOption(id, on) {
  if (id === "guides") {
    guides.setEnabled(on);
    chrome.storage.sync.set({ [GUIDES_STORAGE_KEY]: on });
    if (on && hoveredEl?.isConnected) {
      guides.show(hoveredEl, session.has(editKey(hoveredEl)) ? "edited" : "hover");
    }
    toast.show(
      on ? "Alignment guides on \u2014 hover any element" : "Alignment guides off",
      { tone: "info", duration: 1800 }
    );
    return;
  }

  if (id === "responsive") {
    if (on) {
      showBreakpointPicker();
      toast.show("Pick a width from the bar below", { tone: "info", duration: 2600 });
    } else {
      hideBreakpointPicker();
    }
  }
}

// ============================================================
//  Responsive preview
// ============================================================
let breakpointBar = null;

function showBreakpointPicker() {
  if (breakpointBar) {
    breakpointBar.hidden = false;
    markActiveBreakpoint();
    return;
  }

  breakpointBar = document.createElement("div");
  breakpointBar.id = `${P}-breakpoints`;

  const note = document.createElement("span");
  note.className = `${P}-breakpoint-note`;
  note.textContent = "Resizes the window";
  breakpointBar.appendChild(note);

  for (const bp of BREAKPOINTS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${P}-breakpoint`;
    btn.dataset.id = bp.id;
    btn.textContent = bp.label;
    btn.title = `${bp.width} × ${bp.height}${bp.hint ? ` · ${bp.hint}` : ""}`;
    btn.addEventListener("click", () => applyBreakpoint(bp));
    breakpointBar.appendChild(btn);
  }

  const size = document.createElement("span");
  size.className = `${P}-breakpoint-size`;
  breakpointBar.appendChild(size);

  root.appendChild(breakpointBar);
  markActiveBreakpoint();

  window.addEventListener("resize", markActiveBreakpoint);
}

function hideBreakpointPicker() {
  if (breakpointBar) breakpointBar.hidden = true;
}

async function applyBreakpoint(bp) {
  const { width, height } = windowSizeFor(bp, window);
  const response = await chrome.runtime.sendMessage({
    type: "RESIZE_WINDOW",
    payload: { width, height },
  });

  if (response?.error) {
    toast.show(response.error, {
      tone: response.unsupported ? "warn" : "error",
      duration: 5000,
    });
    return;
  }

  // The resize is asynchronous; let it settle before reading the result.
  setTimeout(markActiveBreakpoint, 250);
}

function markActiveBreakpoint() {
  if (!breakpointBar) return;

  const current = activeBreakpoint(window.innerWidth);
  for (const btn of breakpointBar.querySelectorAll(`.${P}-breakpoint`)) {
    btn.setAttribute("aria-pressed", String(btn.dataset.id === current?.id));
  }

  const size = breakpointBar.querySelector(`.${P}-breakpoint-size`);
  if (size) size.textContent = `${window.innerWidth} × ${window.innerHeight}`;
}

function flipSide() {
  const next = rail.side === "left" ? "right" : "left";
  rail.setSide(next);
  toolCard.setSide(next);
  search.setSide(next);
  chrome.storage.sync.set({ [SIDE_STORAGE_KEY]: next });
  if (hoveredEl?.isConnected) labels.reposition(hoveredEl);
}

function syncRail() {
  rail.setCount(session.count());
  rail.setHistory({ canUndo: session.canUndo(), canRedo: session.canRedo() });
}

/**
 * @param {boolean} visible
 * @param {{selectDefault?: boolean}} opts  selectDefault picks Inspect when
 *        nothing is active — without it the toolbar opens inert: hovering
 *        highlights nothing and the guides toggle sits lit over a feature
 *        that cannot fire, which reads as broken.
 */
function setRailVisible(visible, { selectDefault = true } = {}) {
  if (!rail) return;

  if (visible) {
    rail.show();
    if (selectDefault && !activeTool) rail.selectTool(TOOL.INSPECT);
    return;
  }

  rail.hide(); // also deselects the active tool, which tears down decorations
  teardownInteraction();
  hideBreakpointPicker();
}

// ============================================================
//  Tools
// ============================================================
function selectTool(toolId) {
  const wasInteractive = INTERACTIVE_TOOLS.has(activeTool);
  activeTool = toolId;

  inspector.hide();
  properties.hide();
  structureBar.hide();
  a11yCard.hide();
  labels.hide();
  guides.hide();
  hideCrumbs();

  // Switching tools drops the pin: a measurement anchored by a tool that
  // is no longer active reads as the new tool's doing.
  pinnedEl = null;
  guides.clearMeasure();

  if (INTERACTIVE_TOOLS.has(toolId)) {
    if (!wasInteractive) setupInteraction();
    else scanAndDecorate();

    // The full gesture card, not a one-line toast: a tool with four
    // gestures got to advertise one of them, and the ⌥-click source editor
    // was advertised nowhere at all.
    toolCard.show(toolId);
  } else {
    toolCard.hide();
    if (wasInteractive) teardownInteraction();
  }
}

function runAction(id) {
  switch (id) {
    case "search":
      search.toggle();
      break;
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
  pinnedEl = null;
  toolCard?.hide();

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
  properties.hide();
  a11yCard.hide();
  search.close();
  structureBar.hide();
  sourcePanel?.close();
  hideCrumbs();

  autoDetectMode = false;
  editableEls = [];
  hoveredEl = null;
}

/** Find editable elements, decorate them, and re-apply pending edits. */
function scanAndDecorate() {
  // Pending edits are reapplied whatever the tool. This runs from the DOM
  // observer after a framework re-render, and a re-render replaces edited
  // nodes with their original text — bailing out early for a whole-page
  // tool silently reverted every staged edit the moment someone switched
  // from Edit to Inspect on a live page.
  reapplyPendingEdits();

  // These target anything, so there is nothing to mark out in advance —
  // and marking only the editable ones would say the opposite of what they
  // do. The hover handler paints whatever is under the cursor.
  if (WHOLE_PAGE_TOOLS.has(activeTool)) {
    editableEls = [];
    autoDetectMode = false;
    return;
  }

  const { elements, detected, autoDetected } = findEditableElements(document, isOwnUi);
  editableEls = elements;
  autoDetectMode = autoDetected;

  // Detected elements are *not* stamped with data attributes. What makes an
  // element interactive is the class below, and writing data-editable onto
  // every text node's parent would mutate the host page's markup on every
  // annotated page — visible in the DOM, and in anyone's innerHTML.
  void detected;

  for (const el of elements) el.classList.add(CLS.editable);
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
    // The source panel is showing this element's file. What the editor says
    // is newer than any edit made to the element on its own.
    if (previewOwned.has(el)) continue;

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
  properties.reposition();
  structureBar.reposition();
  if (anchor?.isConnected) {
    labels.reposition(anchor);
    guides.reposition(anchor);
  } else {
    labels.hide();
    guides.hide();
  }
  if (crumbsEl.hidden === false && hoveredEl) positionCrumbs(hoveredEl);
}

/**
 * The search panel's live preview: the same visuals a hover gets, so a
 * match looks exactly like what clicking it will act on.
 */
function highlightFromSearch(el) {
  if (hoveredEl && hoveredEl !== el) {
    hoveredEl.classList.remove(CLS.hovered, CLS.editable);
  }
  if (!el) {
    labels.hide();
    guides.hide();
    hoveredEl = null;
    return;
  }
  hoveredEl = el;
  el.classList.add(CLS.hovered, CLS.editable);
  labels.show(el, { state: "hover" });
  guides.show(el, "hover");
}

// ---- Hover -------------------------------------------------


/** What an event is about. */
function editableFrom(target) {
  if (!target?.closest || isOwnUi(target)) return null;

  if (WHOLE_PAGE_TOOLS.has(activeTool)) return commentTargetFrom(target);
  return target.closest(`.${CLS.editable}`);
}


function onDocumentHover(e) {
  const el = editableFrom(e.target);
  if (!el || el === hoveredEl) return;

  if (hoveredEl) {
    hoveredEl.classList.remove(CLS.hovered);
    // Comment mode adds the pointer cursor itself, since the element was
    // never decorated by the registry.
    if (WHOLE_PAGE_TOOLS.has(activeTool)) hoveredEl.classList.remove(CLS.editable);
  }
  hoveredEl = el;
  el.classList.add(CLS.hovered);
  if (WHOLE_PAGE_TOOLS.has(activeTool)) el.classList.add(CLS.editable);

  const state = session.has(editKey(el)) ? "edited" : "hover";
  labels.show(el, { state });
  guides.show(el, state);

  // Pinned by Inspect, hovering something else: read out the distance.
  if (activeTool === TOOL.INSPECT && pinnedEl?.isConnected && el !== pinnedEl) {
    guides.measure(pinnedEl, el);
  } else {
    guides.clearMeasure();
  }

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
  // Comment mode borrowed this class for the cursor; it was never the
  // registry's, so it has to be given back.
  if (WHOLE_PAGE_TOOLS.has(activeTool)) el.classList.remove(CLS.editable);
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
  // Our own UI handles its own clicks. This listener is on the capture
  // phase, so without this guard it runs *before* a button inside the
  // properties panel and tears the panel down mid-interaction — which made
  // click-driven controls silently do nothing while keyboard-driven ones
  // worked.
  if (isOwnUi(e.target)) return;

  // Alt-click opens the source, whatever tool happens to be active: the
  // gesture is the mode, so a developer never has to go and select one.
  if (e.altKey) {
    const annotated = e.target?.closest?.("[data-edit-file]");
    if (annotated) {
      e.preventDefault();
      e.stopPropagation();
      showSourcePanel(annotated);
      return;
    }

    // No annotation anywhere above it. Copy rendered from a data array has
    // none, and falling through to the Inspect card said nothing about why
    // the editor would not open. Ask the service where the text lives.
    const detected = editableFrom(e.target);
    if (detected) {
      e.preventDefault();
      e.stopPropagation();
      locateThenOpenSource(detected);
      return;
    }
  }

  const el = editableFrom(e.target);
  if (!el) {
    inspector.hide();
    properties.hide();
    a11yCard.hide();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  activateOn(el, e);
}

/**
 * @param {Element} el
 * @param {MouseEvent} [event] carries the pointer position, which is what
 *        decides which run of text is being edited when an element holds
 *        copy beside another element
 */
function activateOn(el, event) {
  // Once someone is using the tool, the gesture card is in the way of the
  // page they are using it on.
  toolCard.hide();

  if (activeTool === TOOL.INSPECT) {
    // The pin: the fixed end of a measurement. Hover something else and the
    // guides read out the distance between them.
    pinnedEl = el;
    inspector.show(el);
    labels.show(el, { state: "selected" });
    guides.show(el, "selected");
    return;
  }
  if (activeTool === TOOL.A11Y) {
    a11yCard.show(el);
    labels.show(el, { state: "selected" });
    guides.show(el, "selected");
    return;
  }

  if (activeTool === TOOL.EDIT) {
    beginEdit(el, event);
    return;
  }

  if (activeTool === TOOL.PROPERTIES) {
    properties.show(el);
    labels.show(el, { state: "selected" });
    guides.show(el, "selected");
    hideCrumbs();
    return;
  }

  if (activeTool === TOOL.STRUCTURE) {
    structureBar.show(el);
    labels.show(el, { state: "selected" });
    guides.show(el, "selected");
    hideCrumbs();
    return;
  }

  if (activeTool === TOOL.COMMENT) {
    labels.show(el, { state: "selected" });
    guides.show(el, "selected");
    hideCrumbs();
    void leaveComment(el);
  }
}

/**
 * Leave a comment on an element.
 *
 * The one path through this tool that is not editing: nothing is staged,
 * nothing is committed, and the page is unchanged. It exists for the person
 * who has noticed something but should not or cannot change it — and where
 * the page is annotated, the comment arrives pinned to the source line,
 * which is what no general feedback tool can do.
 */
async function leaveComment(el) {
  const ctx = await editingContext();

  if (!ctx.known) {
    toast.show(ctx.reason, { tone: "warn", duration: 6000 });
    return;
  }

  // An image is rarely annotated itself, but the component around it is.
  const source = annotationFor(el);

  openCommentComposer({
    root,
    element: el,
    description: describeElement(el),
    source,
    onSubmit: async (message, options = {}) => {
      // Taken before the request, with the overlay hidden, so the image is
      // the customer's page rather than a picture of this tool. A failure
      // here costs the screenshot and never the comment.
      const screenshot = options.screenshot
        ? await captureViewport(getShadowHost())
        : null;

      const stored = await chrome.storage.sync.get(["prServiceUrl"]);
      const response = await chrome.runtime.sendMessage({
        type: "API_POST",
        payload: {
          path: "/api/feedback",
          token: (await getSessionId()) || "",
          serviceUrl: resolveServiceUrl(stored.prServiceUrl),
          body: {
            environmentId: ctx.environmentId,
            message,
            pageUrl: window.location.href,
            element: selectorFor(el),
            sourceFile: source.sourceFile || undefined,
            sourceLine: source.sourceLine ?? undefined,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            screenshot: screenshot || undefined,
          },
        },
      });

      if (response?.error) return { error: response.error };

      toast.show("Comment sent \u2014 it is in the dashboard inbox.", {
        tone: "info",
        duration: 3500,
      });
      return {};
    },
    onClose: () => {
      labels.hide();
      guides.hide();
    },
  });
}

/**
 * Record a move, duplicate or delete.
 *
 * Only annotated elements can be rearranged: there is no text to fall back
 * on when locating the element in source, so without a build annotation the
 * service cannot know which element to touch.
 */
function recordStructuralEdit(op, el) {
  if (!el.dataset.editFile) {
    toast.show(
      "Rearranging needs a build annotation \u2014 this element has none.",
      { tone: "warn", duration: 4500 }
    );
    return;
  }

  // One structural op per element. Queueing a delete *and* a duplicate for
  // the same node asks the service to rewrite overlapping ranges, which it
  // can only resolve by dropping one — better to refuse here and say so.
  const key = `${editKey(el)}#op`;
  const existing = session.get(key);

  if (existing && !isCompatibleOp(existing, op)) {
    toast.show(
      `A ${describeOp(existing)} is already queued for this element. Undo it first.`,
      { tone: "warn", duration: 4500 }
    );
    return;
  }

  // Refuse a move the page cannot make. Without this the UI happily queued
  // a move for an element that is already first or last, which the service
  // then rejected — the edit looked accepted and quietly never arrived.
  if (op === "move-up" && !el.previousElementSibling) {
    toast.show("This is already the first element here.", { tone: "warn" });
    return;
  }
  if (op === "move-down" && !el.nextElementSibling) {
    toast.show("This is already the last element here.", { tone: "warn" });
    return;
  }

  // Repeated nudges accumulate into one signed offset rather than fighting
  // over the same key and silently doing nothing.
  const moveBy =
    op === "move-up" || op === "move-down"
      ? (existing?.moveBy || 0) + (op === "move-up" ? -1 : 1)
      : undefined;

  if (moveBy === 0) {
    // Nudged back to where it started.
    session.remove(key);
    revertEditInDom(el, existing);
    syncRail();
    persistSession();
    toast.show("Back to its original position", { tone: "info" });
    return;
  }

  const description = describeElement(el);
  const normalisedOp = moveBy === undefined ? op : "move";

  session.record({
    key,
    pageUrl: window.location.href,
    framework: el.dataset.editFramework,
    sourceFile: el.dataset.editFile,
    sourceLine: parseInt(el.dataset.editLine, 10),
    sourceColumn: el.dataset.editCol ? parseInt(el.dataset.editCol, 10) : undefined,
    op: normalisedOp,
    moveBy,
    originalText: description,
    originalRaw: description,
    newText: moveBy === undefined
      ? `${normalisedOp} ${description}`
      : `move ${Math.abs(moveBy)} ${Math.abs(moveBy) === 1 ? "place" : "places"} ${moveBy < 0 ? "up" : "down"}`,
  });

  // Preview the single step just taken, not the accumulated total.
  applyStructureOp(el, { op, key });

  syncRail();
  persistSession();
  toast.show(`${describeOp(session.get(key))} queued`, { tone: "done" });
}

/** Moves combine with each other; delete and duplicate stand alone. */
function isCompatibleOp(existing, op) {
  const isMove = (o) => o === "move" || o === "move-up" || o === "move-down";
  return isMove(existing.op) && isMove(op);
}

function describeOp(edit) {
  if (!edit) return "change";
  if (edit.op !== "move") return edit.op;
  const places = Math.abs(edit.moveBy || 1);
  return `move ${places} ${places === 1 ? "place" : "places"} ${edit.moveBy < 0 ? "up" : "down"}`;
}


// ============================================================
//  Editing
// ============================================================
function beginEdit(el, event) {
  if (activeTarget === el) return;
  cancelActiveEditor();

  activeTarget = el;
  el.classList.add(CLS.editing);
  el.classList.remove(CLS.hovered);
  labels.show(el, { state: "selected" });
  guides.show(el, "selected");
  hideCrumbs();

  // Copy beside another element is edited a run at a time, so the overlay
  // covers the run that was clicked rather than the whole element.
  const run = hasMixedContent(el) ? runAtPoint(el, event) : null;

  activeOverlay = openEditorOverlay(el, root, {
    textNode: run?.node,
    onCommit: (text) => commitEdit(el, text, run?.index),
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

function commitEdit(el, rawText, run) {
  const newText = rawText.trim();
  const isRun = typeof run === "number";
  // For a run the original is that text node alone, not the element's text —
  // sending the element's would ask the codemod to match a string that does
  // not exist in the source as one piece.
  const originalRaw = isRun ? textRunsOf(el)[run]?.textContent ?? "" : el.innerText;
  const key = sessionKey(el, undefined, isRun ? run : undefined);

  const { changed } = session.record({
    key,
    pageUrl: window.location.href,
    framework: el.dataset.editFramework,
    sourceFile: el.dataset.editFile,
    sourceLine: el.dataset.editLine ? parseInt(el.dataset.editLine, 10) : undefined,
    // Present when the text comes from a translation call; the service
    // redirects the patch to the locale file rather than the component.
    i18nKey: el.dataset.editI18nKey,
    run: isRun ? run : undefined,
    originalText: originalRaw.trim(),
    originalRaw,
    newText,
  });

  finishEditing(el);
  if (!changed) return;

  const edit = session.get(key);
  if (edit) applyEditToDom(el, edit);
  else revertEditInDom(el, { originalRaw });

  syncRail();
  persistSession();

  const n = session.count();
  toast.show(
    n === 0 ? "Back to the original" : `${n} edit${n === 1 ? "" : "s"} ready to submit`,
    { tone: n === 0 ? "info" : "done" }
  );
}

/**
 * Apply an edit's effect to the page.
 *
 * Edits are no longer all text edits, so this dispatches on kind. It used to
 * assume text unconditionally, which meant undoing an attribute change wrote
 * the attribute's value into the element and destroyed its children.
 */
function applyEditToDom(el, edit) {
  observer?.pause();

  if (edit.op) applyStructureOp(el, edit);
  else if (edit.attribute) {
    // Redoing an image swap has to park srcset again, or the redone
    // preview silently loses to the candidate set — same as the first time.
    if (edit.attribute === "src" && edit.upload) stashResponsiveAttrs(el);
    setAttributeValue(el, edit.attribute, edit.newText);
  }
  else if (typeof edit.run === "number") setRunText(el, edit.run, edit.newText);
  else el.innerText = edit.newText;

  el.classList.add(CLS.dirty);
  observer?.resume();
}

/**
 * Replace one run's text, keeping the whitespace around it.
 *
 * The surrounding spaces are what separate the run from its neighbours —
 * trimming them would weld `you` and `love` together on the page.
 */
function setRunText(el, index, text) {
  const node = textRunsOf(el)[index];
  if (!node || text === undefined) return;

  const [, lead = "", , trail = ""] = /^(\s*)([\s\S]*?)(\s*)$/.exec(node.textContent) || [];
  node.textContent = `${lead}${String(text).trim()}${trail}`;
}

function stashResponsiveAttrs(el) {
  if (stashedResponsive.has(el)) return;
  const parked = {};
  for (const name of ["srcset", "sizes"]) {
    if (el.hasAttribute(name)) {
      parked[name] = el.getAttribute(name);
      el.removeAttribute(name);
    }
  }
  if (Object.keys(parked).length) stashedResponsive.set(el, parked);
}

function restoreResponsiveAttrs(el) {
  const parked = stashedResponsive.get(el);
  if (!parked) return;
  for (const [name, value] of Object.entries(parked)) el.setAttribute(name, value);
  stashedResponsive.delete(el);
}

/** Undo an edit's effect, returning the element to how the page found it. */
function revertEditInDom(el, edit) {
  if (!edit) return;
  observer?.pause();

  if (edit.op) revertStructureOp(el, edit);
  else if (edit.attribute) {
    setAttributeValue(el, edit.attribute, edit.originalText);
    if (edit.attribute === "src") restoreResponsiveAttrs(el);
  }
  else if (typeof edit.run === "number") setRunText(el, edit.run, edit.originalRaw);
  else if (edit.originalRaw !== undefined) el.innerText = edit.originalRaw;

  el.classList.remove(CLS.dirty);
  observer?.resume();
}

/**
 * Write an attribute, preserving our own decoration classes.
 *
 * Assigning `class` wholesale would strip the hover and dirty markers along
 * with it, since those live on the same attribute but belong to us.
 */
function setAttributeValue(el, attribute, value) {
  if (attribute === "class" || attribute === "className") {
    const ours = [...el.classList].filter((c) => c.startsWith(P));
    const theirs = String(value).split(/\s+/).filter(Boolean);
    // setAttribute, not el.className: on an SVG element className is a
    // read-only SVGAnimatedString, and assigning it throws the edit away.
    el.setAttribute("class", [...theirs, ...ours].join(" "));
    return;
  }
  el.setAttribute(attribute, value);
}

/** Show a structural change in the page so it is not invisible until the PR. */
function applyStructureOp(el, edit) {
  if (edit.op === "delete") {
    el.classList.add(CLS.removed);
    structureBar.hide();
    return;
  }

  if (edit.op === "duplicate") {
    if (findCopyFor(edit.key)) return; // already previewed

    const copy = el.cloneNode(true);
    copy.classList.remove(CLS.hovered, CLS.editing, CLS.editable);
    copy.classList.add(CLS.dirty);
    // The copy does not exist in source yet, so it must not be treated as an
    // independently editable element — its annotation would collide with the
    // original's.
    delete copy.dataset.editable;
    delete copy.dataset.editFile;
    delete copy.dataset.editLine;
    copy.dataset.ietCopy = edit.key;
    copy.removeAttribute("id");

    el.insertAdjacentElement("afterend", copy);
    return;
  }

  moveElement(el, edit.op);
}

function revertStructureOp(el, edit) {
  if (edit.op === "delete") {
    el.classList.remove(CLS.removed);
    return;
  }

  if (edit.op === "duplicate") {
    findCopyFor(edit.key)?.remove();
    return;
  }

  // Undo the whole accumulated distance, not the last nudge.
  const steps = Math.abs(edit.moveBy ?? 1);
  const back = (edit.moveBy ?? -1) < 0 ? "move-down" : "move-up";
  for (let i = 0; i < steps; i++) moveElement(el, back);
}

function moveElement(el, op) {
  if (op === "move-up" && el.previousElementSibling) {
    el.parentElement.insertBefore(el, el.previousElementSibling);
  } else if (op === "move-down" && el.nextElementSibling) {
    el.parentElement.insertBefore(el.nextElementSibling, el);
  }
  structureBar.reposition();
}

function findCopyFor(key) {
  return document.querySelector(`[data-iet-copy="${CSS.escape(key)}"]`);
}

function cancelActiveEditor() {
  if (!activeOverlay) return;
  const el = activeTarget;
  activeOverlay.destroy();
  activeOverlay = null;
  activeTarget = null;
  el?.classList.remove(CLS.editing);
}

/**
 * Session keys.
 *
 * One element can carry several independent edits — its text, its alt, its
 * classes, a structural op — so the kind is part of the key. Without it,
 * changing a heading's text would overwrite the record of changing its link.
 */
// ============================================================
//  Text runs
//
//  An element can hold copy beside another element:
//  `<div>Focus on the things you <span>love</span> while we
//  handle the rest</div>`. Rewriting the element would destroy
//  the span, so each run of text is edited on its own — which
//  is exactly what the codemod does to the source.
// ============================================================

/** The element's own non-empty text nodes, in document order. */
function textRunsOf(el) {
  return [...el.childNodes].filter(
    (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
  );
}

/** Does this element hold text beside something else? */
function hasMixedContent(el) {
  return Boolean(el.firstElementChild) && textRunsOf(el).length > 0;
}

/** The run containing a click, or the first one if the click missed. */
function runAtPoint(el, event) {
  const runs = textRunsOf(el);
  if (runs.length === 0) return null;

  const x = event?.clientX;
  const y = event?.clientY;

  if (typeof x === "number") {
    for (let i = 0; i < runs.length; i++) {
      const range = document.createRange();
      range.selectNodeContents(runs[i]);
      for (const rect of range.getClientRects()) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return { node: runs[i], index: i };
        }
      }
    }
  }

  return { node: runs[0], index: 0 };
}

function sessionKey(el, attribute, run) {
  const base = editKey(el);
  if (attribute) return `${base}#attr:${attribute}`;
  if (typeof run === "number") return `${base}#run:${run}`;
  return base;
}

/** Locate the live element for a key, if it is on this page. */
function elementForKey(key) {
  // Keys carry a suffix naming the kind of edit: "#attr:href" or "#op".
  // Stripping only "#attr:" left structural keys unresolvable, so undoing a
  // move cleared the record without putting the element back.
  const base = key.replace(/#(attr:.*|op|run:\d+)$/, "");

  // Resolution must not depend on decoration state. Whole-page tools keep
  // `editableEls` empty and paint the class only on the element under the
  // pointer, so at undo time — which arrives by message, with the pointer
  // anywhere — neither source held the moved element and the record was
  // cleared without the DOM being put back. Annotated elements are found by
  // their annotation instead, which exists whatever the tool is doing.
  // A dom: key *is* a path — resolve it directly. Searching decorated
  // elements for it has the same failure the annotated keys had: at undo
  // time nothing is decorated, and an attribute edit on an unannotated
  // element (which Properties now allows) was cleared without the DOM
  // being put back.
  if (base.startsWith("dom:")) {
    const direct = elementForDomPath(base.slice(4));
    if (direct) return direct;
  }

  const pools = [
    editableEls,
    Array.from(document.querySelectorAll("[data-edit-file]")),
    Array.from(document.querySelectorAll(`.${CLS.editable}`)),
  ];
  for (const pool of pools) {
    const found = pool.find((el) => editKey(el) === base);
    if (found) return found;
  }
  return null;
}

/**
 * Record a change to an attribute or the class list.
 *
 * The element is already updated — the panel applies changes live so the
 * page shows the result — so this only has to persist the intent.
 */
function recordAttributeEdit({ attribute, originalValue, newValue }) {
  const el = properties.target;
  if (!el) return;

  const key = sessionKey(el, attribute);

  const { changed } = session.record({
    key,
    pageUrl: window.location.href,
    framework: el.dataset.editFramework,
    sourceFile: el.dataset.editFile,
    sourceLine: el.dataset.editLine ? parseInt(el.dataset.editLine, 10) : undefined,
    attribute,
    originalText: originalValue,
    originalRaw: originalValue,
    newText: newValue,
  });

  if (!changed) return;

  el.classList.toggle(CLS.dirty, session.count() > 0);
  syncRail();
  persistSession();

  const n = session.count();
  toast.show(`${n} change${n === 1 ? "" : "s"} ready to submit`, { tone: "done" });
}

/**
 * Replace an image.
 *
 * The file is read here and carried with the edit; the service commits the
 * bytes alongside the source change so the pull request is self-contained.
 */
function pickImage(el) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;

    if (file.size > MAX_IMAGE_BYTES) {
      toast.show(
        `That image is ${Math.round(file.size / 1024)}kB; the limit is ${MAX_IMAGE_BYTES / 1024}kB.`,
        { tone: "error", duration: 5000 }
      );
      return;
    }

    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const originalSrc = el.getAttribute("src") || "";
    const targetPath = uploadPathFor(originalSrc, file.name);

    // Show the new image straight away; the source still points at the old
    // path until the pull request lands. srcset would keep winning over a
    // plain src, so it is parked (and restored on undo).
    stashResponsiveAttrs(el);
    el.setAttribute("src", dataUrl);

    session.record({
      key: sessionKey(el, "src"),
      pageUrl: window.location.href,
      framework: el.dataset.editFramework,
      sourceFile: el.dataset.editFile,
      sourceLine: el.dataset.editLine ? parseInt(el.dataset.editLine, 10) : undefined,
      attribute: "src",
      originalText: originalSrc,
      originalRaw: originalSrc,
      newText: targetPath,
      upload: {
        path: targetPath.replace(/^\//, ""),
        dataUrl,
        name: file.name,
        size: file.size,
      },
    });

    el.classList.add(CLS.dirty);
    syncRail();
    persistSession();
    properties.show(el);
    toast.show(`Image will be committed to ${targetPath}`, { tone: "done", duration: 4500 });
  });

  input.click();
}

/**
 * Where an uploaded image should live in the repository.
 *
 * Next to the image it replaces when that looks like a repo path, so the
 * new file lands where a developer would have put it themselves.
 */
export function uploadPathFor(originalSrc, fileName) {
  const safeName = fileName.replace(/[^\w.-]+/g, "-").toLowerCase();

  if (originalSrc && originalSrc.startsWith("/") && !originalSrc.startsWith("//")) {
    const dir = originalSrc.slice(0, originalSrc.lastIndexOf("/"));
    return `${dir || ""}/${safeName}`;
  }

  return `/images/${safeName}`;
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
    if (step.edit) applyEditToDom(el, step.edit);
    else if (previous) revertEditInDom(el, previous);
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

/**
 * Is the keystroke going somewhere text is being typed?
 *
 * Our shadow root is *closed*, so composedPath() stops at the host and can
 * never name a node inside it — a document-level listener simply cannot see
 * that our class input or the code editor has focus. root.activeElement can,
 * and this module owns root, so ask it directly.
 */
function isTypingTarget(e) {
  const inner = root?.activeElement;
  if (
    inner?.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(inner?.tagName || "")
  ) {
    return true;
  }

  // Inputs on the page itself are not retargeted, so e.target is accurate.
  const outer = e.target;
  return Boolean(
    outer?.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(outer?.tagName || "")
  );
}

function onKeydown(e) {
  if (!rail?.visible) return;

  if (e.key === "Escape") {
    toolCard.hide();
    if (search.visible) {
      search.close();
      return;
    }
    if (a11yCard.visible) {
      a11yCard.hide();
      return;
    }
    if (inspector.visible) {
      inspector.hide();
      pinnedEl = null;
      guides.clearMeasure();
      return;
    }
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }

  // Single-key tool switching, but never while typing.
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  // An open editor or source panel takes every plain keystroke — otherwise
  // typing "edit" would switch tools halfway through the word.
  if (activeOverlay || sourcePanel) return;

  if (isTypingTarget(e)) return;

  // The trainer: bring the gesture card back after it got out of the way.
  // shift+/ lands as "?", matching VisBug's habit exactly.
  if (e.key === "?" && INTERACTIVE_TOOLS.has(activeTool)) {
    e.preventDefault();
    toolCard.show(activeTool);
    return;
  }

  // Nudge: with an element picked in Rearrange, the arrows move it. The
  // buttons stay — the keys are for the third and fourth move in a row,
  // where reaching for a button per step is what makes reordering tedious.
  if (activeTool === TOOL.STRUCTURE && structureBar.visible && structureBar.target) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      recordStructuralEdit(e.key === "ArrowUp" ? "move-up" : "move-down", structureBar.target);
      return;
    }
  }

  // Every tool has a key, because the hint cards advertise them — a card
  // that shows a shortcut badge for a key that does nothing teaches people
  // to stop believing the cards.
  const toolFor = {
    i: TOOL.INSPECT,
    a: TOOL.A11Y,
    e: TOOL.EDIT,
    p: TOOL.PROPERTIES,
    r: TOOL.STRUCTURE,
    c: TOOL.COMMENT,
  };
  const tool = toolFor[e.key?.toLowerCase?.()];
  if (tool) {
    rail.selectTool(activeTool === tool ? null : tool);
    return;
  }

  if (e.key?.toLowerCase?.() === "s") {
    // preventDefault, or the very keystroke that opened the panel types
    // itself into the freshly-focused input — every search would begin
    // with a stray "s". This handler runs on capture, so the default
    // insertion has not happened yet.
    e.preventDefault();
    search.toggle();
  }
}

// ============================================================
//  Source editing
// ============================================================
/**
 * Open the file an element came from.
 *
 * Available on any annotated element, not only editable ones — a developer
 * may well want the source of something a writer can never touch.
 */
/**
 * Open the source of text the build did not annotate.
 *
 * There is no file on the element to open, so the repository is searched for
 * the text. A single match opens straight away; several are offered, because
 * a text search can land in more than one place and opening the wrong file
 * is worse than asking.
 */
/**
 * Everything the editing endpoints need, resolved once per page.
 *
 * The page still supplies the build commit — that is what keeps a change
 * request's diff to just these edits — but the repository and branch now
 * come from the site registry, so a page cannot name a repository its
 * editors were never granted.
 */
async function editingContext({ force = false } = {}) {
  const page = resolvePageContext({
    dataset: document.documentElement.dataset,
    hostname: window.location.hostname,
  });

  const stored = await chrome.storage.sync.get(["prServiceUrl"]);
  const site = await resolveSite((message) => chrome.runtime.sendMessage(message), {
    hostname: window.location.hostname,
    token: (await getSessionId()) || "",
    serviceUrl: resolveServiceUrl(stored.prServiceUrl),
    force,
  });

  return {
    ...page,
    ...site,
    // The branch the *server* will use: the registered one, or the page's
    // when the site takes it from there.
    branch: site.branch || page.branch,
    params: site.known ? editingParams(site, page) : null,
  };
}

async function locateThenOpenSource(el) {
  const text = el.textContent.trim().replace(/\s+/g, " ");
  if (!text) return;

  const ctx = await editingContext();

  if (!ctx.known) {
    toast.show(ctx.reason, { tone: "warn", duration: 6000 });
    return;
  }

  toast.show("No annotation here \u2014 searching the repository\u2026", {
    tone: "info",
    duration: 2500,
  });

  const stored = await chrome.storage.sync.get(["prServiceUrl"]);
  const response = await chrome.runtime.sendMessage({
    type: "API_POST",
    payload: {
      path: "/api/editing/locate",
      token: (await getSessionId()) || "",
      serviceUrl: resolveServiceUrl(stored.prServiceUrl),
      body: { environmentId: ctx.environmentId, text },
    },
  });

  const candidates = response?.data?.candidates || [];

  if (candidates.length === 0) {
    toast.show(
      response?.data?.reason || response?.error || "That text is not in the repository.",
      { tone: "warn", duration: 5000 }
    );
    return;
  }

  // One match is unambiguous. Several are not: the same string often appears
  // in three page components, and opening the first would be a guess — which
  // is the thing the confirmation step exists to avoid.
  if (candidates.length > 1) {
    openSourcePicker({
      root,
      element: el,
      candidates,
      onPick: (candidate) =>
        showSourcePanel(el, {
          sourceFile: candidate.sourceFile,
          sourceLine: candidate.sourceLine,
        }),
    });
    return;
  }

  showSourcePanel(el, {
    sourceFile: candidates[0].sourceFile,
    sourceLine: candidates[0].sourceLine,
  });
}

async function showSourcePanel(el, ref) {
  if (sourcePanel) return;

  if (!ref && !sourceRefFor(el)) {
    toast.show("This element has no build annotation, so there is no file to open.", {
      tone: "warn",
      duration: 4500,
    });
    return;
  }

  cancelActiveEditor();
  properties.hide();
  structureBar.hide();


  sourcePanel = await openSourcePanel({
    root,
    element: el,
    ref,
    ctx: await editingContext(),
    onStage: stageSourceEdit,
    onPreview: previewSourceFile,
    onRevert: revertSourcePreview,
    onClose: () => {
      sourcePanel = null;
    },
  });
}

// ============================================================
//  Live preview of a source edit
//
//  An annotated element *is* a line in a file, so an edit to
//  that line can be shown on the page without a rebuild. This
//  is a preview, not a render: what the parser can state as
//  fact is applied, and nothing else. Logic, new elements and
//  {expressions} need a build, and are left alone rather than
//  approximated.
// ============================================================

/** Original text and attributes of everything the preview has touched. */
let previewOriginals = new Map();

/**
 * Elements the source preview has actually changed.
 *
 * While the panel is open these belong to the file, not to the session: a
 * re-render must not put an element-level edit back over what the editor
 * currently says.
 */
let previewOwned = new Set();

/** The outline entry for an element, disambiguated by column when needed. */
function outlineEntryFor(candidates, el) {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Two elements opening on one line. The annotation's column is the only
  // thing that separates them, and indentation may have shifted, so take
  // the nearest rather than requiring an exact match.
  const col = parseInt(el.dataset.editCol, 10);
  if (!Number.isFinite(col)) return candidates[0];

  return candidates.reduce((best, c) =>
    Math.abs(c.column - col) < Math.abs(best.column - col) ? c : best
  );
}

function rememberOriginal(el) {
  if (previewOriginals.has(el)) return;
  previewOriginals.set(el, {
    text: el.textContent,
    className: el.getAttribute("class"),
    attributes: new Map(
      [...el.attributes].map((a) => [a.name, a.value])
    ),
  });
}

/**
 * Show an edited file on the page.
 *
 * Markup and stylesheets need opposite treatment. A stylesheet can be applied
 * exactly — it is declarative, and the browser already knows how to run it.
 * Markup cannot: without a build, only what the parser can state outright
 * about each annotated element is safe to apply.
 *
 * @param {string} path
 * @param {{kind: 'markup', outline: Map}|{kind: 'style', css: string}} change
 */
function previewSourceFile(path, change) {
  if (change.kind === "style") {
    previewStylesheet(path, change.css);
    return 1;
  }
  return previewMarkup(path, change.outline);
}

/**
 * Apply an edited file to every element on the page that came from it.
 *
 * @param {string} sourceFile
 * @param {Map<number, object[]>} outline  by line, from the editor
 */
function previewMarkup(sourceFile, outline) {
  const selector = `[data-edit-file="${CSS.escape(sourceFile)}"][data-edit-line]`;
  let changed = 0;

  for (const el of document.querySelectorAll(selector)) {
    if (isOwnUi(el)) continue;

    const line = parseInt(el.dataset.editLine, 10);
    const entry = outlineEntryFor(outline.get(line), el);
    if (!entry) continue;

    rememberOriginal(el);
    let touched = false;

    // Text only where the source element holds text alone. An element with
    // children of its own keeps them — including any that are themselves
    // annotated and previewed on their own line.
    if (entry.text !== null && !el.firstElementChild) {
      if (el.textContent.trim() !== entry.text) {
        el.textContent = entry.text;
        touched = true;
      }
    } else if (entry.runs?.length) {
      // Copy beside another element: each run is replaced on its own, so the
      // child survives. Only when the source and the page agree on how many
      // runs there are — if they disagree the mapping is a guess, and a
      // guess here would put text in the wrong place.
      const nodes = textRunsOf(el);
      if (nodes.length === entry.runs.length) {
        entry.runs.forEach((value, i) => {
          if (nodes[i].textContent.trim() === value) return;
          setRunText(el, i, value);
          touched = true;
        });
      }
    }

    for (const [name, value] of Object.entries(entry.attributes)) {
      const domName = name === "className" ? "class" : name;
      if (el.getAttribute(domName) === value) continue;
      // Goes through the shared setter so our decoration classes survive.
      setAttributeValue(el, domName, value);
      touched = true;
    }

    if (touched) {
      el.classList.add(CLS.dirty);
      previewOwned.add(el);
      changed++;
    }
  }

  return changed;
}

// ---- Stylesheets -------------------------------------------
/** Our injected <style> per previewed path. */
const previewStyles = new Map();
/** Link/style elements we switched off so the edit could take effect. */
const disabledSheets = new Set();

/**
 * Is this stylesheet the built form of the file being edited?
 *
 * A preview deploy serves hashed, often bundled CSS, so this can only ever
 * be a guess — and it is used solely to switch a sheet off, which the revert
 * undoes. Matching on the file's own name keeps the guess narrow.
 */
function isBuiltFrom(node, path) {
  const base = path.split("/").pop().replace(/\.\w+$/, "");
  const href = node.getAttribute?.("href") || "";
  return href.includes(base);
}

/**
 * Show edited CSS on the page.
 *
 * The edited file is appended last so its rules win at equal specificity.
 * Where the original sheet can be identified it is switched off as well, so
 * that *removing* a rule takes effect too — appending alone could only ever
 * add and override.
 */
function previewStylesheet(path, cssText) {
  let tag = previewStyles.get(path);

  if (!tag) {
    tag = document.createElement("style");
    tag.dataset.ietStylePreview = path;
    previewStyles.set(path, tag);

    for (const node of document.querySelectorAll("link[rel~=stylesheet], style")) {
      if (node === tag || isOwnUi(node)) continue;
      if (!isBuiltFrom(node, path)) continue;
      if (node.sheet) {
        node.sheet.disabled = true;
        disabledSheets.add(node);
      }
    }
  }

  if (tag.textContent !== cssText) tag.textContent = cssText;
  // Always last, so a later-loading sheet cannot end up on top of the edit.
  document.head.appendChild(tag);
}

function revertStylePreview() {
  for (const tag of previewStyles.values()) tag.remove();
  previewStyles.clear();

  for (const node of disabledSheets) {
    if (node.sheet) node.sheet.disabled = false;
  }
  disabledSheets.clear();
}

/** Put the page back the way it was before the panel opened. */
function revertSourcePreview() {
  revertStylePreview();

  for (const [el, original] of previewOriginals) {
    if (!el.isConnected) continue;

    if (el.textContent !== original.text && !el.firstElementChild) {
      el.textContent = original.text;
    }

    for (const [name, value] of original.attributes) {
      if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    }
    // An attribute the edit introduced has no original to restore.
    for (const attr of [...el.attributes]) {
      if (!original.attributes.has(attr.name)) el.removeAttribute(attr.name);
    }
    if (original.className !== null) el.setAttribute("class", original.className);
  }

  previewOriginals = new Map();
  previewOwned = new Set();
  scanAndDecorate();
}

/**
 * Record a whole-file change.
 *
 * Keyed by path rather than by element: two edits to the same file through
 * this panel are the same edit, and the last one wins.
 */
function stageSourceEdit(files) {
  // An element edited with another tool and then rewritten here would be
  // committed twice: the file lands first, then the element's codemod runs
  // on top of it and quietly undoes what was typed in the editor. The source
  // edit is the later and more specific of the two, so it supersedes them.
  let superseded = 0;
  for (const el of previewOwned) {
    if (session.remove(editKey(el))) superseded++;
  }

  // The preview is now represented by these edits, so there is nothing left
  // to revert — and a stale original must not survive to be restored later.
  previewOriginals = new Map();
  previewOwned = new Set();

  for (const { sourceFile, content, baseSha, sourceLine, linesChanged } of files) {
    session.record({
      key: `file:${sourceFile}`,
      pageUrl: window.location.href,
      sourceFile,
      sourceLine,
      kind: "file",
      fileContent: content,
      baseSha,
      linesChanged,
      originalText: sourceFile,
      originalRaw: sourceFile,
      newText: `edited ${sourceFile.split("/").pop()}`,
    });
  }

  syncRail();
  persistSession();

  const what =
    files.length === 1
      ? files[0].sourceFile.split("/").pop()
      : `${files.length} files`;
  const replaced = superseded
    ? ` \u00b7 replaced ${superseded} element edit${superseded === 1 ? "" : "s"}`
    : "";
  toast.show(`${what} staged \u2014 review before submitting${replaced}`, {
    tone: "done",
    duration: superseded ? 5000 : 3000,
  });
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
    ctx: await editingContext(),
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
        setRailVisible(true, { selectDefault: false });
        rail.selectTool(TOOL.EDIT);
      } else {
        rail.selectTool(null);
      }
      sendResponse(editState());
      return false;

    case "SET_TOOL":
      setRailVisible(true, { selectDefault: false });
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
    if (element) revertEditInDom(element, edit);
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
