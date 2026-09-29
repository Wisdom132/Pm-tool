'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Vite plugin — runs the editor itself on an example page.
 *
 * The extension's own demo (inline-edit-tool/extension/preview.html) proves
 * the UI against canned fixtures. This does the same for the example apps,
 * with one important difference: `/api/file` reads the **real file from
 * disk**, so opening a component's source shows what is actually in the
 * repository, and an edit previews against the markup that produced the page.
 *
 * It serves the built extension rather than copying it, so `npm run build:ext`
 * is picked up on the next reload with nothing to keep in sync.
 *
 * Dev only. A production build of an example ships no editor.
 */

/** Where the built extension lives when this runs inside its own repository. */
const BUNDLED_DIST = path.resolve(__dirname, '../inline-edit-tool/extension/dist');

/** Served files, by request path. */
function assetsFrom(dist) {
  return {
    '/__iet/content.js': { file: path.join(dist, 'content.js'), type: 'text/javascript' },
    '/__iet/code-editor.js': { file: path.join(dist, 'code-editor.js'), type: 'text/javascript' },
    '/__iet/page.css': { file: path.join(dist, 'page.css'), type: 'text/css' },
  };
}

/**
 * A file's contents, or null if it is outside the project.
 *
 * The path arrives from a page annotation, which is generated — but it is
 * still input arriving over HTTP, so it is resolved and then checked to be
 * inside the root rather than trusted.
 */
function readProjectFile(root, requested) {
  const resolved = path.resolve(root, requested);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) return null;

  try {
    return fs.readFileSync(resolved, 'utf8');
  } catch {
    return null;
  }
}

/**
 * @param {object} [options]
 * @param {string} [options.root]         where annotated paths resolve from;
 *                                        defaults to the directory the build
 *                                        runs in, which is what the annotation
 *                                        plugins make their paths relative to
 * @param {string} [options.extensionDist] the extension's built dist/, for use
 *                                        from outside this repository
 * @param {string} [options.repo]
 * @param {string} [options.branch]
 * @param {boolean} [options.autoOpen]  open the toolbar on load; set false to
 *                                      summon it with the shortcut instead
 */
/** Directories never worth searching. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.nuxt', '.output', 'dist', 'build', '.next',
  'coverage', '.cache', '.vercel',
]);

const SEARCHABLE = /\.(vue|jsx?|tsx?|svelte|html?|astro|mdx?|json)$/i;

/**
 * Where a piece of text appears in the working tree.
 *
 * Deliberately a literal search, not a fuzzy one: a near match offered as a
 * candidate invites someone to confirm the wrong file, and the whole point
 * of the confirmation step is that nothing is written on a guess.
 *
 * @returns {{candidates: Array<{sourceFile, sourceLine, snippet}>, reason: string|null}}
 */
function locateText(root, text) {
  const needle = String(text).trim();
  if (needle.length < 3) {
    return { candidates: [], reason: 'Too short to search for' };
  }

  const candidates = [];

  (function walk(dir) {
    if (candidates.length >= 8) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (candidates.length >= 8) return;

      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(full);
        continue;
      }
      if (!SEARCHABLE.test(entry.name)) continue;

      let contents;
      try {
        contents = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      if (!contents.includes(needle)) continue;

      const lines = contents.split('\n');
      for (let i = 0; i < lines.length && candidates.length < 8; i++) {
        if (!lines[i].includes(needle)) continue;
        candidates.push({
          sourceFile: path.relative(root, full),
          sourceLine: i + 1,
          snippet: lines[i].trim().slice(0, 140),
        });
      }
    }
  })(root);

  return {
    candidates,
    reason: candidates.length ? null : `"${needle}" is not in the working tree`,
  };
}

module.exports = function inlineEditPreview({
  root = process.cwd(),
  extensionDist = BUNDLED_DIST,
  repo = 'local/project',
  branch = 'local',
  autoOpen = true,
} = {}) {
  const ASSETS = assetsFrom(extensionDist);

  return {
    name: 'inline-edit-preview',
    apply: 'serve',

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [url, query] = req.url.split('?');

        const asset = ASSETS[url];
        if (asset) {
          if (!fs.existsSync(asset.file)) {
            res.statusCode = 503;
            res.setHeader('Content-Type', 'text/plain');
            res.end(
              `${asset.file} does not exist.\n\n` +
                `Build the extension:  npm run build:ext\n` +
                `From another project, point the plugin at it:\n` +
                `  inlineEditPreview({ extensionDist: '/path/to/inline-edit-tool/extension/dist' })\n`
            );
            return;
          }
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Type', asset.type);
          res.end(fs.readFileSync(asset.file));
          return;
        }

        if (url === '/__iet/shim.js') {
          // Never cached: the shim is generated from this file, and a browser
          // holding yesterday's copy is indistinguishable from the plugin not
          // having been updated — which cost a debugging session once.
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Type', 'text/javascript');
          res.end(shimSource({ repo, branch, autoOpen }));
          return;
        }

        // The real service reads from GitHub; here the working tree is the
        // branch, which is the point — you edit the file you are looking at.
        // The service resolves unannotated text with GitHub code search.
        // Here the working tree is searched directly, which is faster and
        // means the Locate flow works without the service running.
        if (url === '/__iet/locate') {
          const text = new URLSearchParams(query || '').get('text') || '';
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(locateText(root, text)));
          return;
        }

        if (url === '/__iet/file') {
          const wanted = new URLSearchParams(query || '').get('path') || '';
          const content = readProjectFile(root, wanted);

          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Type', 'application/json');
          if (content === null) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: `${wanted} is not in the working tree` }));
            return;
          }
          res.end(JSON.stringify({ path: wanted, content, sha: `worktree-${Date.now()}` }));
          return;
        }

        next();
      });
    },

    transformIndexHtml(html) {
      return {
        html,
        tags: [
          // The extension resolves which build it is editing from these.
          {
            tag: 'script',
            attrs: { type: 'module' },
            // Only as a fallback: the annotation plugin stamps the real repo
            // and branch from git or CI, and those are the ones an actual
            // preview deploy is editing.
            children:
              `const html = document.documentElement;\n` +
              `html.dataset.editRepo ||= ${JSON.stringify(repo)};\n` +
              `html.dataset.editBranch ||= ${JSON.stringify(branch)};`,
            injectTo: 'head-prepend',
          },
          { tag: 'link', attrs: { rel: 'stylesheet', href: '/__iet/page.css' }, injectTo: 'head' },
          // The shim has to install chrome.* before the content script runs.
          { tag: 'script', attrs: { src: '/__iet/shim.js' }, injectTo: 'body' },
          { tag: 'script', attrs: { src: '/__iet/content.js' }, injectTo: 'body' },
        ],
      };
    },
  };
};

/**
 * The chrome.* stub, as source.
 *
 * Inlined rather than shipped as a file so it can close over the repo and
 * branch the plugin was configured with.
 */
function shimSource({ repo, branch, autoOpen }) {
  return `
(function () {
  "use strict";

  // The UI lives in a closed shadow root; opting in lets a test drive it.
  window.__IET_ALLOW_TEST_HOOKS__ = true;

  const contentHandlers = [];
  const listeners = [];

  function areaStore(prefix) {
    return {
      async get(keys) {
        const names = Array.isArray(keys) ? keys : keys ? [keys] : [];
        const out = {};
        for (const key of names) {
          const raw = localStorage.getItem(prefix + key);
          if (raw !== null) out[key] = JSON.parse(raw);
        }
        return out;
      },
      async set(values) {
        for (const [key, value] of Object.entries(values)) {
          localStorage.setItem(prefix + key, JSON.stringify(value));
        }
        for (const fn of listeners) fn(values, prefix.includes("sync") ? "sync" : "local");
      },
      async remove(key) {
        localStorage.removeItem(prefix + key);
      },
    };
  }

  async function handleMessage(message) {
    const { type, payload } = message;

    // There is no dashboard here, so the example is always "signed in" and
    // the site is always registered. Everything the real API decides —
    // which repository, which branch — is answered from the flags this
    // preview was started with.
    const ENVIRONMENT_ID = "00000000-0000-4000-8000-000000000001";

    if (type === "SIGN_IN") {
      await chrome.storage.local.set({ authToken: "example", authLogin: "example-user" });
      return { token: "example", login: "example-user" };
    }

    if (type === "API_FETCH") {
      const path = payload.path;

      // The site registry, faked. The extension asks this first, before any
      // editing call, and gets back the environment id it then sends.
      if (path.startsWith("/api/resolve")) {
        return {
          data: {
            known: true,
            environmentId: ENVIRONMENT_ID,
            siteId: "00000000-0000-4000-8000-000000000002",
            hostname: location.hostname,
            label: "preview",
            repository: ${JSON.stringify(repo)},
            branch: ${JSON.stringify(branch)},
            provider: "github",
            accountLogin: "example",
            baseUrl: null,
            verified: true,
            organisationId: "00000000-0000-4000-8000-000000000003",
          },
        };
      }

      if (path.startsWith("/api/editing/file")) {
        // Straight to the working tree, so the editor shows the real file.
        const query = path.split("?")[1] || "";
        const wanted = new URLSearchParams(query).get("path");
        const response = await fetch("/__iet/file?path=" + encodeURIComponent(wanted));
        const body = await response.json();
        return response.ok ? { data: body } : { error: body.error };
      }

      if (path.startsWith("/api/editing/branches")) {
        return { data: { branches: [${JSON.stringify(branch)}] } };
      }
      if (path.startsWith("/api/editing/preview-status")) {
        return { data: { status: "identical", usable: true, aheadBy: 0 } };
      }
      if (path.includes("/repositories")) {
        return { data: [{ fullName: ${JSON.stringify(repo)}, private: false }] };
      }

      return { error: "example shim: unhandled path " + path };
    }

    if (type === "API_POST") {
      const path = payload.path;

      if (path.startsWith("/api/editing/locate")) {
        const response = await fetch(
          "/__iet/locate?text=" + encodeURIComponent(payload.body?.text || "")
        );
        return { data: await response.json() };
      }

      // Observer mode, where a page has no annotations to patch. Refused
      // for the same reason pull requests are: this preview has no
      // repository to file against.
      if (path.startsWith("/api/editing/issues")) {
        return {
          error:
            "This example does not open issues. Use the extension against a real preview deploy.",
        };
      }

      // Comments are echoed to the console rather than stored: there is no
      // inbox here to put them in, and silently succeeding would suggest
      // there is.
      if (path.startsWith("/api/feedback")) {
        const body = payload.body || {};
        console.info(
          "[inline-edit] comment (not sent anywhere — this is the example preview)",
          {
            message: body.message,
            element: body.element,
            source: body.sourceFile
              ? body.sourceFile + (body.sourceLine ? ":" + body.sourceLine : "")
              : "not annotated",
          }
        );
        return { data: { id: "example", status: "new" } };
      }

      return { error: "example shim: unhandled post " + path };
    }

    if (type === "LOAD_CODE_EDITOR") {
      if (globalThis.__IET_CODE_EDITOR__) return { ok: true };
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/__iet/code-editor.js";
        script.onload = resolve;
        script.onerror = () => reject(new Error("could not load the code editor chunk"));
        document.head.appendChild(script);
      });
      return { ok: true };
    }

    // A web page cannot resize the window the way the installed extension
    // can, and pretending otherwise would report a success that never happened.
    if (type === "RESIZE_WINDOW") {
      return { error: "Responsive preview needs the installed extension.", unsupported: true };
    }

    if (type === "CREATE_PR") {
      return { error: "This example does not open pull requests. Use the extension against a real preview deploy." };
    }

    return { error: "example shim: unhandled message " + type };
  }

  window.chrome = {
    runtime: {
      id: "example".padEnd(32, "a"),
      sendMessage: handleMessage,
      onMessage: { addListener(fn) { contentHandlers.push(fn); } },
      __dispatchToContent(message) {
        return new Promise((resolve) => {
          for (const fn of contentHandlers) fn(message, {}, resolve);
        });
      },
    },
    storage: {
      local: areaStore("iet_local_"),
      sync: areaStore("iet_sync_"),
      onChanged: { addListener(fn) { listeners.push(fn); } },
    },
    windows: {
      async getCurrent() { return { id: 1 }; },
      async update() { return { id: 1 }; },
    },
    tabs: {
      async query() { return [{ id: 1, url: location.href }]; },
      async sendMessage(_id, message) { return chrome.runtime.__dispatchToContent(message); },
    },
  };

  const toggle = () => chrome.runtime.__dispatchToContent({ type: "TOGGLE_TOOLBAR" });

  // The toolbar is a working surface, not decoration: on a project where the
  // module stays in nuxt.config it would otherwise appear on every reload
  // during ordinary development.
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "e") {
      e.preventDefault();
      toggle();
    }
  });

  if (${JSON.stringify(Boolean(autoOpen))}) {
    window.addEventListener("load", () => setTimeout(toggle, 60));
  }

  console.log(
    "[inline-edit] ready \\u2014 " +
      (${JSON.stringify(Boolean(autoOpen))} ? "alt-click any text" : "press Cmd/Ctrl+Shift+E") +
      " \\u00b7 Cmd/Ctrl+Shift+E toggles the toolbar"
  );
})();
`;
}
