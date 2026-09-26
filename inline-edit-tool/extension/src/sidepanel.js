"use strict";

// ============================================================
//  Side panel
//
//  The session overview. Reads pending edits straight out of
//  chrome.storage.local rather than messaging the content
//  script — the content script already persists them there, so
//  storage is the single source of truth and the panel stays
//  correct across navigation, reloads and tab switches.
//
//  Submitting still happens in the page, because the review
//  modal needs the page's own repo/branch annotations.
// ============================================================

const SESSION_KEY = "editSession";

const el = (id) => document.getElementById(id);

let activeTool = null;

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Send to the content script, returning null if it is not present. */
async function sendToPage(message) {
  const tab = await activeTab();
  if (!tab?.id) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    return null; // browser page, extension page, or not yet injected
  }
}

async function readSession() {
  const stored = await chrome.storage.local.get([SESSION_KEY]);
  const data = stored[SESSION_KEY];
  return Array.isArray(data?.edits) ? data.edits : [];
}

async function writeSession(edits) {
  if (edits.length === 0) {
    await chrome.storage.local.remove(SESSION_KEY);
    return;
  }
  const stored = await chrome.storage.local.get([SESSION_KEY]);
  await chrome.storage.local.set({
    [SESSION_KEY]: { ...stored[SESSION_KEY], edits },
  });
}

function shortPath(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search || "/";
  } catch {
    return url || "(unknown page)";
  }
}

function render(edits, currentUrl) {
  const list = el("list");
  list.textContent = "";

  el("empty").style.display = edits.length ? "none" : "";
  el("submit-btn").disabled = edits.length === 0;
  el("discard-btn").disabled = edits.length === 0;

  const pages = [...new Set(edits.map((e) => e.pageUrl))];

  el("summary").textContent = edits.length
    ? `${edits.length} edit${edits.length === 1 ? "" : "s"}` +
      (pages.length > 1 ? ` across ${pages.length} pages` : "")
    : "";

  for (const pageUrl of pages) {
    const group = document.createElement("div");
    group.className = "page-group";

    const head = document.createElement("div");
    head.className = "page-head";
    head.textContent = shortPath(pageUrl);
    if (pageUrl === currentUrl) {
      const tag = document.createElement("span");
      tag.className = "current";
      tag.textContent = " · this page";
      head.appendChild(tag);
    }
    group.appendChild(head);

    for (const edit of edits.filter((e) => e.pageUrl === pageUrl)) {
      group.appendChild(renderEdit(edit, edits));
    }

    list.appendChild(group);
  }
}

function renderEdit(edit, allEdits) {
  const row = document.createElement("div");
  row.className = "edit";

  const body = document.createElement("div");
  body.className = "edit-body";

  if (edit.sourceFile) {
    const file = document.createElement("div");
    file.className = "edit-file";
    file.textContent = edit.sourceFile.split("/").pop() +
      (edit.sourceLine ? `:${edit.sourceLine}` : "");
    body.appendChild(file);
  }

  const before = document.createElement("div");
  before.className = "edit-before";
  before.textContent = edit.originalText;

  const after = document.createElement("div");
  after.className = "edit-after";
  after.textContent = edit.newText;

  body.append(before, after);

  const remove = document.createElement("button");
  remove.className = "remove";
  remove.title = "Discard this edit";
  remove.textContent = "×";
  remove.addEventListener("click", async () => {
    await writeSession(allEdits.filter((e) => e.key !== edit.key));
    await sendToPage({ type: "SESSION_REPLACED" });
    await refresh();
  });

  row.append(body, remove);
  return row;
}

/** Mirror the in-page rail: exactly one tool active, or none. */
function setToolButtons(tool, available) {
  activeTool = tool || null;
  for (const btn of document.querySelectorAll("[data-tool]")) {
    btn.className = btn.dataset.tool === activeTool ? "on" : "";
    btn.disabled = !available;
  }
}

async function refresh() {
  const tab = await activeTab();
  const state = await sendToPage({ type: "GET_EDIT_STATE" });
  const available = state !== null;

  el("unavailable").style.display = available ? "none" : "";
  setToolButtons(state?.tool, available);

  el("undo-btn").disabled = !available || !state?.canUndo;
  el("redo-btn").disabled = !available || !state?.canRedo;

  render(await readSession(), tab?.url);
}

// ---- Wiring ------------------------------------------------
for (const btn of document.querySelectorAll("[data-tool]")) {
  btn.addEventListener("click", async () => {
    // Clicking the active tool switches it off, as the rail does.
    const next = activeTool === btn.dataset.tool ? null : btn.dataset.tool;
    await sendToPage({ type: "SET_TOOL", tool: next });
    await refresh();
  });
}

el("undo-btn").addEventListener("click", async () => {
  await sendToPage({ type: "UNDO" });
  await refresh();
});

el("redo-btn").addEventListener("click", async () => {
  await sendToPage({ type: "REDO" });
  await refresh();
});

el("submit-btn").addEventListener("click", async () => {
  // The review modal lives in the page: it needs the repo, branch and commit
  // that the annotation plugin stamped onto this document.
  const result = await sendToPage({ type: "OPEN_SUBMIT_PANEL" });
  if (result === null) {
    el("unavailable").style.display = "";
  }
});

el("discard-btn").addEventListener("click", async () => {
  await writeSession([]);
  await sendToPage({ type: "SESSION_REPLACED" });
  await refresh();
});

// Keep in step with edits made in the page.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[SESSION_KEY]) refresh();
});

chrome.tabs.onActivated.addListener(() => refresh());
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === "complete") refresh();
});

refresh();
