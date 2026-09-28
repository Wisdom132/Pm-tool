'use strict';

import { resolveServiceUrl } from './config.js';
import { getSessionId, setSession } from './auth-storage.js';

// ============================================================
//  Inline Edit Tool — background service worker
//
//  GITHUB_AUTH — launches GitHub OAuth via chrome.identity,
//                stores the resulting session id, returns it.
//  API_FETCH   — proxies GET requests to the pr-service so that
//                content scripts (which inherit the page's HTTPS
//                context) are not blocked by mixed-content rules.
//  CREATE_PR   — POSTs edits to the pr-service.
// ============================================================

// Clicking the toolbar icon opens the side panel alongside the popup.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── GitHub OAuth flow ──────────────────────────────────────
  if (message.type === 'GITHUB_AUTH') {
    const serviceUrl = resolveServiceUrl(message.payload.serviceUrl);
    const authUrl = `${serviceUrl}/api/auth/extension?ext_id=${chrome.runtime.id}`;

    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        const raw = chrome.runtime.lastError?.message || 'Auth cancelled';

        // Chrome reports an unreachable start page as "Authorization page
        // could not be loaded", which says nothing about the cause. By far
        // the most common one is that the pr-service is not running.
        const unreachable = /could not be loaded|ERR_|net::/i.test(raw);
        sendResponse({
          error: unreachable
            ? `Could not reach the pull-request service at ${serviceUrl}. ` +
              `Start it with "npm run dev:svc", or set a different Service URL in the extension popup.`
            : raw,
          serviceUrl,
          unreachable,
        });
        return;
      }
      try {
        const params = new URL(redirectUrl).searchParams;
        const token  = params.get('token');
        if (!token) throw new Error('No token in redirect URL');
        const login = params.get('login');
        setSession(token, login);
        sendResponse({ token, login });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    });

    return true; // async response
  }

  // ── Proxy GET requests to pr-service (avoids mixed-content) ─
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

  // ── Proxy POST requests to pr-service ──────────────────────
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

  // ── Create PR ──────────────────────────────────────────────
  if (message.type === 'CREATE_PR') {
    (async () => {
      try {
        const stored = await chrome.storage.sync.get(['prServiceUrl']);

        const authToken  = message.payload._authToken  || (await getSessionId()) || '';
        const serviceUrl = resolveServiceUrl(message.payload._serviceUrl || stored.prServiceUrl);

        const { _authToken, _serviceUrl, ...serverPayload } = message.payload;

        const res = await fetch(`${serviceUrl}/api/create-pr`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          body: JSON.stringify(serverPayload),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          sendResponse({ error: data.error || `HTTP ${res.status}` });
        } else {
          sendResponse({ prUrl: data.prUrl, prNumber: data.prNumber, branchName: data.branchName });
        }
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();

    return true;
  }

  return false;
});
