"use strict";

// ============================================================
//  chrome.* stub for preview.html
//
//  Lets the shipped dist/content.js run in a plain page. Storage
//  is backed by localStorage; GitHub calls return canned data.
//  This exists so the demo exercises the real editor instead of
//  a second copy of it that drifts.
// ============================================================

(function () {
  const FAKE_REPOS = [
    { full_name: "acme/site", private: false },
    { full_name: "acme/marketing", private: true },
  ];

  const FAKE_BRANCHES = {
    "acme/site": ["main", "feature/copy-fixes", "staging"],
    "acme/marketing": ["main", "develop"],
  };

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  function areaStore(prefix) {
    return {
      async get(keys) {
        const names = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const key of names) {
          const raw = localStorage.getItem(prefix + key);
          if (raw !== null) {
            try {
              out[key] = JSON.parse(raw);
            } catch {
              out[key] = raw;
            }
          }
        }
        return out;
      },
      async set(values) {
        for (const [key, value] of Object.entries(values)) {
          localStorage.setItem(prefix + key, JSON.stringify(value));
        }
        listeners.forEach((fn) => fn(values, prefix === "iet_local_" ? "local" : "sync"));
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          localStorage.removeItem(prefix + key);
        }
        listeners.forEach((fn) => fn({}, prefix === "iet_local_" ? "local" : "sync"));
      },
    };
  }

  const listeners = [];
  const contentHandlers = [];

  async function handleMessage(message) {
    const { type, payload } = message;

    if (type === "GITHUB_AUTH") {
      await delay(600);
      await chrome.storage.local.set({
        authToken: "preview-session",
        authLogin: "preview-user",
      });
      return { token: "preview-session", login: "preview-user" };
    }

    if (type === "API_FETCH") {
      await delay(250);
      const path = payload.path;

      if (path.startsWith("/api/repos")) return { data: { repos: FAKE_REPOS } };

      if (path.startsWith("/api/branches")) {
        const repo = decodeURIComponent(new URLSearchParams(path.split("?")[1]).get("repo"));
        return { data: { branches: FAKE_BRANCHES[repo] || ["main"] } };
      }

      if (path.startsWith("/api/preview-status")) {
        // Exercises the stale-preview banner.
        return { data: { status: "ahead", behindBy: 2, usable: true } };
      }

      return { error: `preview shim: unhandled path ${path}` };
    }

    if (type === "CREATE_PR") {
      await delay(900);
      console.log("[preview] create-pr payload", payload);
      return {
        prUrl: `https://github.com/${payload.repo}/pull/42`,
        prNumber: 42,
        branchName: "inline-edit/preview",
      };
    }

    return { error: `preview shim: unhandled message ${type}` };
  }

  window.chrome = {
    runtime: {
      id: "preview".padEnd(32, "a"),
      sendMessage: handleMessage,
      onMessage: {
        addListener(fn) {
          contentHandlers.push(fn);
        },
      },
      /** Drive the content script from the demo page. */
      __dispatchToContent(message) {
        return new Promise((resolve) => {
          for (const fn of contentHandlers) fn(message, {}, resolve);
        });
      },
    },
    storage: {
      local: areaStore("iet_local_"),
      sync: areaStore("iet_sync_"),
      onChanged: {
        addListener(fn) {
          listeners.push(fn);
        },
      },
    },
    tabs: {
      async query() {
        return [{ id: 1, url: location.href }];
      },
      async sendMessage(_id, message) {
        return chrome.runtime.__dispatchToContent(message);
      },
    },
  };

  console.log("[preview] chrome.* shim installed");
})();
