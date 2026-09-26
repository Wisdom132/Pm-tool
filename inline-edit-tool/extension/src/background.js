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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

  // ── GitHub OAuth flow ──────────────────────────────────────
  if (message.type === 'GITHUB_AUTH') {
    const serviceUrl = resolveServiceUrl(message.payload.serviceUrl);
    const authUrl = `${serviceUrl}/api/auth/extension?ext_id=${chrome.runtime.id}`;

    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        sendResponse({ error: chrome.runtime.lastError?.message || 'Auth cancelled' });
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
