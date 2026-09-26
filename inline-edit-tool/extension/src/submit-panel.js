"use strict";

import { DEFAULT_SERVICE_URL, resolveServiceUrl } from "./config.js";
import { getSessionId, getSessionLogin, clearSession } from "./auth-storage.js";
import { describeSource } from "./page-context.js";
import { diffWords, renderDiff } from "./ui/diff.js";

const P = "__iet";
const ID_REPO = `${P}-conn-repo`;
const ID_BRANCH = `${P}-conn-branch`;

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Persist repo + branch per hostname so future visits auto-fill. */
async function saveSiteSettings(updates) {
  const s = await chrome.storage.sync.get(["siteSettings"]);
  const map = s.siteSettings || {};
  const h = window.location.hostname;
  map[h] = { ...(map[h] || {}), ...updates };
  await chrome.storage.sync.set({ siteSettings: map });
}

/**
 * Build and mount the review/submit panel.
 *
 * @param {object}     opts
 * @param {ShadowRoot} opts.root
 * @param {object}     opts.session   edit session
 * @param {object}     opts.ctx       page context (repo/branch/commit)
 * @param {Function}   opts.onClose
 * @param {Function}   opts.onSubmitted
 * @returns {{close: () => void}}
 */
export async function openSubmitPanel({ root, session, ctx, onClose, onSubmitted, onOpen }) {
  // A stale toast peeking out from behind the backdrop looks like a bug.
  onOpen?.();
  const stored = await chrome.storage.sync.get(["prServiceUrl", "siteSettings"]);
  const sessionId = await getSessionId();

  const savedSettings = (stored.siteSettings || {})[window.location.hostname] || {};
  let targetRepo = ctx.repo || savedSettings.repo || null;
  let targetBranch = ctx.branch || savedSettings.branch || null;
  let manualMode = !ctx.complete;

  const edits = session.list();
  const currentUrl = window.location.href;
  const multiPage = session.pageCount() > 1;

  // Observer mode: nothing on these pages was annotated at build time, so
  // there is no source file to patch. The edits still have value — they go
  // to an issue instead of being guessed into a commit.
  const observerMode = edits.every((e) => !e.sourceFile && !e.i18nKey);

  // ── Shell ────────────────────────────────────────────────
  const panelEl = document.createElement("div");
  panelEl.id = `${P}-panel-backdrop`;

  const card = document.createElement("div");
  card.id = `${P}-panel-card`;

  const title = document.createElement("h2");
  title.textContent = "Review Changes";
  card.appendChild(title);

  if (multiPage) {
    const span = document.createElement("p");
    span.id = `${P}-multipage-note`;
    span.textContent = `${edits.length} edits across ${session.pageCount()} pages will be submitted as one pull request.`;
    card.appendChild(span);
  }

  if (edits.every((e) => !e.sourceFile)) {
    const warn = document.createElement("p");
    warn.id = `${P}-source-warn`;
    warn.textContent =
      "ℹ️ No annotation plugin detected — source files will be located automatically via GitHub code search. Works best for unique text strings.";
    card.appendChild(warn);
  }

  // ── Edits table ──────────────────────────────────────────
  const table = document.createElement("table");
  table.id = `${P}-edits-table`;

  const columns = multiPage ? ["Page", "File", "Before", "After"] : ["File", "Before", "After"];
  const headRow = table.createTHead().insertRow();
  for (const col of columns) {
    const th = document.createElement("th");
    th.textContent = col;
    headRow.appendChild(th);
  }

  const tbody = table.createTBody();
  for (const edit of edits) {
    const row = tbody.insertRow();

    if (multiPage) {
      const cell = row.insertCell();
      try {
        cell.textContent = new URL(edit.pageUrl).pathname || "/";
      } catch {
        cell.textContent = "—";
      }
      if (edit.pageUrl !== currentUrl) cell.style.color = "#6b7280";
    }

    const fname = edit.sourceFile ? edit.sourceFile.split("/").pop() : null;
    const lineN = edit.sourceLine ? `:${edit.sourceLine}` : "";
    const fileCell = row.insertCell();
    fileCell.textContent = fname ? `${fname}${lineN}` : "—";
    if (!fname) fileCell.style.color = "#d1d5db";

    // Mark the words that actually changed, rather than leaving the reader
    // to compare two full sentences.
    const parts = diffWords(edit.originalText, edit.newText);
    renderDiff(row.insertCell(), parts, "removed");
    renderDiff(row.insertCell(), parts, "added");
  }
  card.appendChild(table);

  /**
   * The file column: a resolved path, or a way to find one.
   *
   * Unannotated text used to be guessed at on the server and committed
   * wherever the guess landed. Now the editor is shown candidates and picks.
   */
  function renderFileCell(cell, edit) {
    cell.textContent = "";

    if (edit.sourceFile) {
      const name = edit.sourceFile.split("/").pop();
      cell.textContent = `${name}${edit.sourceLine ? `:${edit.sourceLine}` : ""}`;
      cell.title = edit.sourceFile;
      cell.classList.toggle(`${P}-located`, Boolean(edit.sourceFileConfirmed));
      return;
    }

    const locateBtn = document.createElement("button");
    locateBtn.className = `${P}-locate-btn`;
    locateBtn.type = "button";
    locateBtn.textContent = "Locate\u2026";
    locateBtn.addEventListener("click", () => locate(edit, cell, locateBtn));
    cell.appendChild(locateBtn);
  }

  /** Ask the service where this text lives, then let the editor choose. */
  async function locate(edit, cell, trigger) {
    trigger.disabled = true;
    trigger.textContent = "Searching\u2026";

    const s = await chrome.storage.sync.get(["prServiceUrl"]);
    const response = await chrome.runtime.sendMessage({
      type: "API_POST",
      payload: {
        path: "/api/locate",
        token: (await getSessionId()) || "",
        serviceUrl: resolveServiceUrl(s.prServiceUrl),
        body: { repo: targetRepo, branch: targetBranch, text: edit.originalText },
      },
    });

    if (response?.error || !response?.data) {
      showLocateMessage(cell, response?.error || "Search failed");
      return;
    }

    const { candidates, reason } = response.data;
    if (!candidates || candidates.length === 0) {
      showLocateMessage(cell, reason || "No match found");
      return;
    }

    renderCandidates(cell, edit, candidates);
  }

  function showLocateMessage(cell, message) {
    cell.textContent = "";
    const note = document.createElement("span");
    note.className = `${P}-locate-note`;
    note.textContent = message;
    cell.appendChild(note);
  }

  function renderCandidates(cell, edit, candidates) {
    cell.textContent = "";

    const list = document.createElement("div");
    list.className = `${P}-candidates`;

    for (const candidate of candidates) {
      const option = document.createElement("button");
      option.className = `${P}-candidate`;
      option.type = "button";
      option.title = candidate.snippet;

      const path = document.createElement("span");
      path.className = `${P}-candidate-path`;
      path.textContent = `${candidate.sourceFile}:${candidate.sourceLine}`;
      option.appendChild(path);

      option.addEventListener("click", () => {
        // Confirmed by a human — mark it so the PR body can say so.
        edit.sourceFile = candidate.sourceFile;
        edit.sourceLine = candidate.sourceLine;
        edit.sourceFileConfirmed = true;
        session.attachSource(edit.key, candidate);
        renderFileCell(cell, edit);
        refreshSubmitState();
      });

      list.appendChild(option);
    }

    cell.appendChild(list);
  }

  /**
   * A pull request needs a target and at least one edit with a source file.
   * An issue only needs a repository.
   */
  function refreshSubmitState() {
    const anyResolved = session.list().some((e) => e.sourceFile || e.i18nKey);
    confirmBtn.disabled = !targetRepo || !targetBranch || !anyResolved;
    issueBtn.disabled = !targetRepo;

    confirmBtn.title = anyResolved
      ? ""
      : "No edit has a source file yet \u2014 use Locate, or file an issue instead";
  }

  // ── Note ─────────────────────────────────────────────────
  const noteLabel = document.createElement("label");
  noteLabel.id = `${P}-note-label`;
  noteLabel.htmlFor = `${P}-note`;
  noteLabel.textContent = "Note (optional)";
  const noteInput = document.createElement("textarea");
  noteInput.id = `${P}-note`;
  noteInput.placeholder = "Describe what changed and why…";
  card.appendChild(noteLabel);
  card.appendChild(noteInput);

  // ── Connection ───────────────────────────────────────────
  const connSection = document.createElement("div");
  connSection.id = `${P}-conn-section`;

  const connTitle = document.createElement("div");
  connTitle.id = `${P}-conn-title`;
  connTitle.textContent = "Submit via";
  connSection.appendChild(connTitle);

  function mkSelect(id, labelText) {
    const wrap = document.createElement("div");
    wrap.className = `${P}-conn-row`;
    const lbl = document.createElement("label");
    lbl.htmlFor = id;
    lbl.textContent = labelText;
    const sel = document.createElement("select");
    sel.id = id;
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "— select —";
    sel.appendChild(ph);
    wrap.appendChild(lbl);
    wrap.appendChild(sel);
    return { wrap, sel };
  }

  const step1 = document.createElement("div");
  step1.id = `${P}-conn-step1`;
  const connectBtn = document.createElement("button");
  connectBtn.id = `${P}-connect-btn`;
  connectBtn.textContent = "Connect with GitHub →";
  step1.appendChild(connectBtn);
  connSection.appendChild(step1);

  const step2 = document.createElement("div");
  step2.id = `${P}-conn-step2`;
  step2.style.display = "none";

  const connStatus = document.createElement("div");
  connStatus.id = `${P}-conn-status`;
  step2.appendChild(connStatus);

  const detectedRow = document.createElement("div");
  detectedRow.id = `${P}-detected-row`;
  detectedRow.style.display = "none";
  const detectedText = document.createElement("span");
  detectedText.id = `${P}-detected-text`;
  const changeBtn = document.createElement("button");
  changeBtn.id = `${P}-change-target`;
  changeBtn.textContent = "Change";
  detectedRow.appendChild(detectedText);
  detectedRow.appendChild(changeBtn);
  step2.appendChild(detectedRow);

  const repo = mkSelect(ID_REPO, "Repository");
  const branch = mkSelect(ID_BRANCH, "Branch");
  step2.appendChild(repo.wrap);
  step2.appendChild(branch.wrap);

  connSection.appendChild(step2);
  card.appendChild(connSection);

  const resultEl = document.createElement("div");
  resultEl.id = `${P}-result`;
  card.appendChild(resultEl);

  // ── Buttons ──────────────────────────────────────────────
  const btnRow = document.createElement("div");
  btnRow.id = `${P}-panel-btns`;

  const cancelBtn = document.createElement("button");
  cancelBtn.id = `${P}-panel-cancel`;
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => close());

  const confirmBtn = document.createElement("button");
  confirmBtn.id = `${P}-panel-confirm`;
  confirmBtn.textContent = "Open Pull Request →";
  confirmBtn.disabled = true;
  confirmBtn.addEventListener("click", () => submit());

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(confirmBtn);
  card.appendChild(btnRow);

  panelEl.appendChild(card);
  panelEl.addEventListener("click", (e) => {
    if (e.target === panelEl) close();
  });
  root.appendChild(panelEl);

  function close() {
    panelEl.remove();
    onClose?.();
  }

  // ── Target resolution ────────────────────────────────────
  async function showDetectedTarget() {
    const login = await getSessionLogin();
    connStatus.textContent = `✓ Connected${login ? ` as @${login}` : ""}`;
    connStatus.style.color = "#16a34a";

    const hints = [describeSource(ctx.repoSource), describeSource(ctx.branchSource)].filter(
      Boolean
    );
    const hint = hints.length ? ` (${[...new Set(hints)].join(", ")})` : "";
    detectedText.textContent = `${targetRepo} @ ${targetBranch}${hint}`;

    detectedRow.style.display = "";
    repo.wrap.style.display = "none";
    branch.wrap.style.display = "none";
    step1.style.display = "none";
    step2.style.display = "";
    refreshSubmitState();
  }

  async function loadRepos(token, serviceUrl) {
    const response = await chrome.runtime.sendMessage({
      type: "API_FETCH",
      payload: { path: "/api/repos", token, serviceUrl },
    });
    if (response.error) throw new Error(response.error);

    const login = await getSessionLogin();
    const list = response.data.repos;
    connStatus.textContent = `✓ Connected${login ? ` as @${login}` : ""} — ${list.length} repo${list.length === 1 ? "" : "s"}`;
    connStatus.style.color = "#16a34a";

    for (const r of list) {
      const opt = document.createElement("option");
      opt.value = r.full_name;
      opt.textContent = r.full_name + (r.private ? " 🔒" : "");
      repo.sel.appendChild(opt);
    }

    step1.style.display = "none";
    step2.style.display = "";

    if (targetRepo && list.some((r) => r.full_name === targetRepo)) {
      repo.sel.value = targetRepo;
      await loadBranches(targetRepo);
    }
  }

  async function loadBranches(repoName) {
    const s = await chrome.storage.sync.get(["prServiceUrl"]);
    const token = (await getSessionId()) || "";
    const serviceUrl = resolveServiceUrl(s.prServiceUrl);

    branch.wrap.querySelector(`.${P}-branch-hint`)?.remove();

    if (repoName) saveSiteSettings({ repo: repoName });
    confirmBtn.disabled = true;

    if (!repoName) {
      branch.sel.innerHTML = '<option value="">— select —</option>';
      return;
    }

    branch.sel.innerHTML = '<option value="">Loading…</option>';

    try {
      const response = await chrome.runtime.sendMessage({
        type: "API_FETCH",
        payload: {
          path: `/api/branches?repo=${encodeURIComponent(repoName)}`,
          token,
          serviceUrl,
        },
      });
      if (response.error) throw new Error(response.error);

      branch.sel.innerHTML = '<option value="">— select —</option>';
      for (const b of response.data.branches) {
        const opt = document.createElement("option");
        opt.value = b;
        opt.textContent = b;
        branch.sel.appendChild(opt);
      }

      const candidate = ctx.branch || targetBranch;
      const match = candidate
        ? response.data.branches.find(
            (b) => b === candidate || b.toLowerCase() === candidate.toLowerCase()
          )
        : null;

      if (match) {
        branch.sel.value = match;
        targetBranch = match;
        refreshSubmitState();
        const hintEl = document.createElement("span");
        hintEl.className = `${P}-branch-hint`;
        hintEl.textContent = ctx.branch ? "auto-detected" : "remembered";
        branch.wrap.appendChild(hintEl);
        saveSiteSettings({ branch: match });
      }
    } catch (err) {
      branch.sel.innerHTML = `<option value="">Error: ${escHtml(err.message)}</option>`;
    }
  }

  async function enterManualMode(token, serviceUrl) {
    manualMode = true;
    detectedRow.style.display = "none";
    repo.wrap.style.display = "";
    branch.wrap.style.display = "";
    confirmBtn.disabled = true;
    await loadRepos(token, serviceUrl);
  }

  /** Warn when the build commit is no longer on the branch. */
  async function checkPreviewFreshness(token, serviceUrl) {
    if (!ctx.commit || !targetRepo || !targetBranch) return;

    const query =
      `repo=${encodeURIComponent(targetRepo)}` +
      `&branch=${encodeURIComponent(targetBranch)}` +
      `&commit=${encodeURIComponent(ctx.commit)}`;

    let data;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "API_FETCH",
        payload: { path: `/api/preview-status?${query}`, token, serviceUrl },
      });
      if (response.error) return;
      data = response.data;
    } catch {
      return;
    }

    if (!data || data.status === "identical") return;

    const warn = document.createElement("p");
    warn.id = `${P}-stale-warn`;
    warn.textContent = data.usable
      ? `ℹ️ This preview is ${data.behindBy} commit(s) behind ${targetBranch}. Your edits will apply cleanly to the commit it was built from.`
      : `⚠️ This preview was built from a commit no longer on ${targetBranch} — it was rebased or force-pushed. Edits will apply to the current branch tip; review the PR carefully.`;
    warn.className = data.usable ? `${P}-hint` : `${P}-warn`;
    detectedRow.insertAdjacentElement("afterend", warn);
  }

  async function onConnected(token, serviceUrl) {
    if (manualMode) {
      await enterManualMode(token, serviceUrl);
      return;
    }
    await showDetectedTarget();
    checkPreviewFreshness(token, serviceUrl);
  }

  // ── Submit ───────────────────────────────────────────────
  async function submit() {
    if (!targetRepo || !targetBranch) return;

    const s = await chrome.storage.sync.get(["prServiceUrl"]);
    const token = (await getSessionId()) || "";
    const serviceUrl = resolveServiceUrl(s.prServiceUrl);

    confirmBtn.disabled = true;
    confirmBtn.textContent = "Creating PR…";
    resultEl.textContent = "";

    try {
      const response = await chrome.runtime.sendMessage({
        type: "CREATE_PR",
        payload: {
          pageUrl: currentUrl,
          note: noteInput.value.trim(),
          edits: session.toPayloadEdits(),
          repo: targetRepo,
          branch: targetBranch,
          buildCommit: ctx.commit || null,
          _authToken: token,
          _serviceUrl: serviceUrl,
        },
      });

      if (response.error) {
        resultEl.innerHTML = `<span style="color:#dc2626">Error: ${escHtml(response.error)}</span>`;
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Open Pull Request →";
        return;
      }

      resultEl.innerHTML =
        `<span style="color:#16a34a">✅ PR created: ` +
        `<a href="${escHtml(response.prUrl)}" target="_blank">${escHtml(response.prUrl)}</a></span>`;

      await onSubmitted?.();
      setTimeout(close, 3500);
    } catch (err) {
      resultEl.innerHTML = `<span style="color:#dc2626">Error: ${escHtml(err.message)}</span>`;
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Open Pull Request →";
    }
  }

  async function submitIssue() {
    if (!targetRepo) return;

    const s = await chrome.storage.sync.get(["prServiceUrl"]);
    issueBtn.disabled = true;
    issueBtn.textContent = "Filing\u2026";
    resultEl.textContent = "";

    try {
      const response = await chrome.runtime.sendMessage({
        type: "API_POST",
        payload: {
          path: "/api/create-issue",
          token: (await getSessionId()) || "",
          serviceUrl: resolveServiceUrl(s.prServiceUrl),
          body: {
            repo: targetRepo,
            pageUrl: currentUrl,
            note: noteInput.value.trim(),
            edits: session.toPayloadEdits(),
          },
        },
      });

      if (response?.error) {
        resultEl.innerHTML = `<span style="color:#dc2626">Error: ${escHtml(response.error)}</span>`;
        issueBtn.disabled = false;
        issueBtn.textContent = "File as issue";
        return;
      }

      const { issueUrl } = response.data;
      resultEl.innerHTML =
        `<span style="color:#16a34a">\u2705 Issue filed: ` +
        `<a href="${escHtml(issueUrl)}" target="_blank">${escHtml(issueUrl)}</a></span>`;

      await onSubmitted?.();
      setTimeout(close, 3500);
    } catch (err) {
      resultEl.innerHTML = `<span style="color:#dc2626">Error: ${escHtml(err.message)}</span>`;
      issueBtn.disabled = false;
      issueBtn.textContent = "File as issue";
    }
  }

  // ── Wiring ───────────────────────────────────────────────
  changeBtn.addEventListener("click", async () => {
    const s = await chrome.storage.sync.get(["prServiceUrl"]);
    changeBtn.disabled = true;
    try {
      await enterManualMode(
        (await getSessionId()) || "",
        resolveServiceUrl(s.prServiceUrl)
      );
    } catch (err) {
      resultEl.innerHTML = `<span style="color:#dc2626">${escHtml(err.message)}</span>`;
      changeBtn.disabled = false;
    }
  });

  repo.sel.addEventListener("change", async () => {
    targetRepo = repo.sel.value;
    refreshSubmitState();
    await loadBranches(targetRepo);
  });

  branch.sel.addEventListener("change", () => {
    targetBranch = branch.sel.value;
    refreshSubmitState();
    branch.wrap.querySelector(`.${P}-branch-hint`)?.remove();
    if (targetBranch) saveSiteSettings({ branch: targetBranch });
  });

  connectBtn.addEventListener("click", async () => {
    const serviceUrl = resolveServiceUrl(stored.prServiceUrl);
    connectBtn.textContent = "Opening GitHub…";
    connectBtn.disabled = true;
    resultEl.textContent = "";

    try {
      const response = await chrome.runtime.sendMessage({
        type: "GITHUB_AUTH",
        payload: { serviceUrl },
      });
      if (response.error) throw new Error(response.error);
      await onConnected(response.token, serviceUrl);
    } catch (err) {
      connectBtn.disabled = false;
      connectBtn.textContent = "Connect with GitHub →";
      resultEl.innerHTML = `<span style="color:#dc2626">Auth failed: ${escHtml(err.message)}</span>`;
    }
  });

  // ── Auto-connect ─────────────────────────────────────────
  if (sessionId) {
    const serviceUrl = resolveServiceUrl(stored.prServiceUrl);
    connectBtn.textContent = "Connecting…";
    connectBtn.disabled = true;
    try {
      await onConnected(sessionId, serviceUrl);
    } catch {
      connectBtn.disabled = false;
      connectBtn.textContent = "Connect with GitHub →";
      await clearSession();
    }
  }

  return { close };
}
