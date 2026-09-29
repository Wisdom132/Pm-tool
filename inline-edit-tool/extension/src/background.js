'use strict';

import { resolveServiceUrl } from './config.js';
import { getSessionId, setSession } from './auth-storage.js';

// ============================================================
//  Inline Edit Tool — background service worker
//
//  SIGN_IN     — verifies a dashboard-issued token, then stores it.
//  API_FETCH   — proxies GET requests to the API so that
//                content scripts (which inherit the page's HTTPS
//                context) are not blocked by mixed-content rules.
//  CREATE_PR   — POSTs edits to the API.
// ============================================================

// Clicking the toolbar icon opens the side panel alongside the popup.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── Sign in with a token from the dashboard ────────────────
  //
  //  There is no OAuth flow any more. The extension authenticates to *us*,
  //  not to GitHub — so no provider token ever reaches the browser, and a
  //  leaked extension token is not a leaked GitHub token.
  //
  //  It cannot receive a magic link either, having no inbox, so a
  //  signed-in person creates a token in the dashboard and pastes it in.
  //  This verifies it before storing, because a token that is wrong in
  //  chrome.storage fails later on a page, where the cause is invisible.
  if (message.type === 'SIGN_IN') {
    (async () => {
      const serviceUrl = resolveServiceUrl(message.payload.serviceUrl);
      const token = String(message.payload.token || '').trim();

      if (!token) {
        sendResponse({ error: 'Paste the token from the dashboard.' });
        return;
      }

      try {
        const res = await fetch(`${serviceUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.status === 401) {
          sendResponse({ error: 'That token is not valid, or it has been revoked.' });
          return;
        }
        if (!res.ok) {
          sendResponse({ error: `The API answered ${res.status}.` });
          return;
        }

        const me = await res.json();
        const label = me?.user?.name || me?.user?.email || null;
        await setSession(token, label);
        sendResponse({ token, login: label, organisations: me?.organisations ?? [] });
      } catch (err) {
        sendResponse({
          error:
            `Could not reach the Inline Edit API at ${serviceUrl}. ` +
            `Start it with "npm run dev:api", or set a different Service URL below.`,
        });
      }
    })();

    return true; // async response
  }

  // ── Proxy GET requests to the API (avoids mixed-content) ───
  if (message.type === 'API_FETCH') {
    (async () => {
      try {
        const stored = await chrome.storage.sync.get(['prServiceUrl']);
        const token      = message.payload.token      || (await getSessionId()) || '';
        const serviceUrl = resolveServiceUrl(message.payload.serviceUrl || stored.prServiceUrl);

        const res  = await fetch(`${serviceUrl}${message.payload.path}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) sendResponse({ error: data.error || `HTTP ${res.status}` });
        else         sendResponse({ data });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ── Inject the CodeMirror chunk on demand ──────────────────
  // It is ~158kB gzipped, so it must not ride along with the content
  // script. Injecting into the ISOLATED world puts it in the same context
  // as the content script, where it can publish its factory on a global.
  if (message.type === 'LOAD_CODE_EDITOR') {
    (async () => {
      try {
        if (!sender?.tab?.id) {
          sendResponse({ error: 'No tab to inject into.' });
          return;
        }

        await chrome.scripting.executeScript({
          target: { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] },
          files: ['code-editor.js'],
          world: 'ISOLATED',
        });

        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ error: `Could not load the code editor: ${err.message}` });
      }
    })();
    return true;
  }

  // ── Resize the window for a breakpoint preview ─────────────
  // Media queries answer to the viewport, so previewing a breakpoint means
  // genuinely resizing the window; scaling the page would not trigger them.
  if (message.type === 'RESIZE_WINDOW') {
    (async () => {
      try {
        // Added to the manifest after the first release; an extension loaded
        // before that has to be reloaded before Chrome grants it.
        if (!chrome.windows?.update) {
          sendResponse({
            error:
              'The "windows" permission is missing. Reload the extension at chrome://extensions.',
          });
          return;
        }

        // Resize the window the request came from. getCurrent() in a
        // service worker returns the last *focused* window, which is not
        // necessarily the one the page is in.
        const windowId = sender?.tab?.windowId ?? (await chrome.windows.getCurrent()).id;

        // A maximised or full-screen window ignores width and height, so it
        // has to be restored first.
        const target = await chrome.windows.get(windowId);
        if (target.state !== 'normal') {
          await chrome.windows.update(windowId, { state: 'normal' });
        }

        const updated = await chrome.windows.update(windowId, {
          width: Math.round(message.payload.width),
          height: Math.round(message.payload.height),
        });

        sendResponse({ ok: true, width: updated.width, height: updated.height });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ── Proxy POST requests to the API ─────────────────────────
  if (message.type === 'API_POST') {
    (async () => {
      try {
        const stored = await chrome.storage.sync.get(['prServiceUrl']);
        const token      = message.payload.token || (await getSessionId()) || '';
        const serviceUrl = resolveServiceUrl(message.payload.serviceUrl || stored.prServiceUrl);

        const res = await fetch(`${serviceUrl}${message.payload.path}`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(message.payload.body || {}),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) sendResponse({ error: data.error || `HTTP ${res.status}` });
        else         sendResponse({ data });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ── Screenshot the visible tab ─────────────────────────────
  //
  // Only the service worker can call this; a content script has no access to
  // `chrome.tabs`. It captures the *visible* viewport, which is the right
  // thing here — a comment is about what the person was looking at, and a
  // full-page capture would not show where they had scrolled to.
  //
  // The content script hides its own overlay before asking, so the image is
  // the customer's page rather than a picture of this tool.
  if (message.type === 'CAPTURE_TAB') {
    (async () => {
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab({
          // JPEG, not PNG: a screenshot of a real page is several megabytes
          // as PNG and a fraction of that as JPEG, and the API caps the
          // upload at 512KB. Quality 70 is legible text.
          format: 'jpeg',
          quality: 70,
        });
        sendResponse({ data: dataUrl });
      } catch (err) {
        // Capture fails on privileged pages, and when the tab is not
        // focused. A comment without a screenshot is still a comment, so
        // this is reported and never thrown.
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ── Create PR ──────────────────────────────────────────────
  if (message.type === 'CREATE_PR') {
    (async () => {
      try {
        const stored = await chrome.storage.sync.get(['prServiceUrl']);

        const authToken  = message.payload._authToken  || (await getSessionId()) || '';
        const serviceUrl = resolveServiceUrl(message.payload._serviceUrl || stored.prServiceUrl);

        const { _authToken, _serviceUrl, ...serverPayload } = message.payload;

        const res = await fetch(`${serviceUrl}/api/editing/change-requests`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          body: JSON.stringify(serverPayload),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          // The API answers `{ message }`; the old service answered
          // `{ error }`. Accept either, so a stale deployment still reports
          // something readable.
          const message = Array.isArray(data.message) ? data.message[0] : data.message;
          sendResponse({ error: message || data.error || `HTTP ${res.status}` });
        } else {
          sendResponse({
            // `changeUrl` is the provider-neutral name; prUrl is kept
            // because the panels still read it.
            prUrl: data.changeUrl || data.prUrl,
            prNumber: data.changeNumber || data.prNumber,
            branchName: data.branchName,
            staleness: data.staleness,
            applied: data.applied,
            failures: data.failures,
          });
        }
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();

    return true;
  }

  return false;
});
