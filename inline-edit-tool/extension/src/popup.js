'use strict';

import { DEFAULT_SERVICE_URL, resolveServiceUrl, validateServiceUrl } from './config.js';
import { getSessionId, getSessionLogin, clearSession, clearLegacySession } from './auth-storage.js';

// ============================================================
//  Inline Edit Tool — popup
// ============================================================

let editMode = false;

async function renderPreview() {
  const stored    = await chrome.storage.sync.get(['prServiceUrl']);
  const sessionId = await getSessionId();
  const connected = !!sessionId;
  const login     = connected ? await getSessionLogin() : null;

  // Status row
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  if (connected) {
    dot.className    = 'status-dot green';
    text.textContent = login ? `Connected as @${login}` : 'Connected';
  } else {
    dot.className    = 'status-dot yellow';
    text.textContent = 'Not connected';
  }

  // Service URL preview
  const pvUrl = document.getElementById('pv-url');
  pvUrl.textContent = stored.prServiceUrl || DEFAULT_SERVICE_URL;
  pvUrl.className   = 'preview-value';

  // Disconnect button visibility
  document.getElementById('disconnect-btn').style.display = connected ? '' : 'none';

  // Hint
  document.getElementById('hint-section').style.display = connected ? 'none' : 'block';
}

function showEditForm(stored) {
  document.getElementById('prServiceUrl').value = stored.prServiceUrl || DEFAULT_SERVICE_URL;

  document.getElementById('edit-form').classList.add('visible');
  document.getElementById('save-btn').style.display  = '';
  document.getElementById('toggle-btn').textContent  = 'Cancel';
}

function hideEditForm() {
  document.getElementById('edit-form').classList.remove('visible');
  document.getElementById('save-btn').style.display = 'none';
  document.getElementById('toggle-btn').textContent = 'Edit settings';
}

async function save() {
  const status = document.getElementById('save-status');
  const raw = document.getElementById('prServiceUrl').value.trim() || DEFAULT_SERVICE_URL;

  // The extension sends a bearer token to this origin, so reject anything
  // that would put it on the wire in plaintext.
  const result = validateServiceUrl(raw);
  if (!result.ok) {
    status.textContent = result.error;
    status.style.color = '#dc2626';
    return;
  }

  await chrome.storage.sync.set({ prServiceUrl: result.url });
  hideEditForm();
  editMode = false;
  renderPreview();

  status.style.color = '';
  status.textContent = 'Saved!';
  setTimeout(() => { status.textContent = ''; }, 1500);
}

// ── Editor toggle ─────────────────────────────────────────────
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function applyToggleState(btn, visible) {
  btn.textContent = visible ? 'Hide Editor' : 'Show Editor';
  btn.className   = visible ? 'on' : 'off';
}

async function initEditorToggle() {
  const btn = document.getElementById('editor-toggle-btn');
  const tab = await getActiveTab();

  if (!tab?.id) { btn.disabled = true; return; }

  // Query current state from content script
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'GET_TOOLBAR_STATE' });
    applyToggleState(btn, res?.visible ?? false);
  } catch {
    // Content script not ready (e.g. extension/settings pages) — disable toggle
    btn.disabled = true;
    btn.title = 'Not available on this page';
    return;
  }

  btn.addEventListener('click', async () => {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_TOOLBAR' });
      applyToggleState(btn, res?.visible ?? false);
    } catch { /* tab navigated away */ }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await clearLegacySession();
  await renderPreview();
  await initEditorToggle();

  document.getElementById('toggle-btn').addEventListener('click', async () => {
    editMode = !editMode;
    if (editMode) {
      const stored = await chrome.storage.sync.get(['prServiceUrl']);
      showEditForm(stored);
    } else {
      hideEditForm();
    }
  });

  document.getElementById('save-btn').addEventListener('click', save);

  document.getElementById('disconnect-btn').addEventListener('click', async () => {
    const stored = await chrome.storage.sync.get(['prServiceUrl']);
    const sessionId = await getSessionId();
    if (sessionId) {
      // Revoke the GitHub token so the next OAuth flow shows the full
      // consent screen (including org access) from scratch.
      const serviceUrl = resolveServiceUrl(stored.prServiceUrl);
      try {
        await fetch(`${serviceUrl}/api/auth/revoke`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${sessionId}` },
        });
      } catch { /* ignore — still disconnect locally */ }
    }
    await clearSession();
    renderPreview();
  });
});
