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
  // The UI lives in a closed shadow root. This demo page opts into exposing
  // it so the end-to-end tests can drive real controls instead of clicking
  // at guessed coordinates.
  window.__IET_ALLOW_TEST_HOOKS__ = true;

  // ============================================================
  //  Stand-in source files
  //
  //  The demo has no repository behind it, so these play the part of
  //  what GET /api/file returns. Their line numbers are built to match
  //  the data-edit-line annotations in preview.html: a fixture that
  //  ignored them would highlight the wrong line, and serving one file
  //  for every path makes every element look like the same element.
  // ============================================================
  const SOURCE_FILES = {
    "src/pages/index.jsx": [
          "import { Badge } from '../components/Badge';",
          "import { Features } from '../components/Features';",
          "import './hero.css';",
          "export default function Home({ t }) {",
          "  const year = new Date().getFullYear();",
          "",
          "  return (",
          "    <main>",
          "      <img className=\"hero-logo rounded shadow-sm\" src=\"/logo.png\" alt=\"Acme Corp logo\" />",
          "",
          "      <section className=\"hero\">",
          "        <h1>Build things that mater</h1>",
          "",
          "        {/* Keep the subhead to two short sentences. */}",
          "        <p>The fastest way to ship high-quality products. Trusted by 10,000+ tems worldwide.</p>",
          "      </section>",
          "",
          "      <Features />",
          "",
          "      {/* --------------------------------------------------",
          "          Nested editables: the span inside the paragraph is",
          "          annotated in its own right, so the breadcrumb has",
          "          something to walk up to.",
          "          -------------------------------------------------- */}",
          "      <section className=\"nested\">",
          "        <Badge>Since {year}</Badge>",
          "",
          "        {/* Rendered as a span rather than an anchor so the demo",
          "            has a nested editable that is not a link. */}",
          "",
          "        <p>",
          "          Read our <span className=\"link\">getting started guide</span> to ship your first change.",
          "        </p>",
          "",
          "        {/* Copy that lives in a locale file rather than here. */}",
          "        <p>{t('home.cta.subtitle')}</p>",
          "",
          "        {/* The structure tools move and duplicate these, so the",
          "            list needs more than one child to be interesting. */}",
          "        <ol id=\"steps\">",
          "          {/* Keep in sync with the docs sidebar. */}",
          "          {/* TODO: read from content/steps.json once that lands. */}",
          "",
          "          <li>Install the plugin</li>",
          "          <li>Deploy a preview</li>",
          "          <li>Edit and open a PR</li>",
          "        </ol>",
          "      </section>",
          "    </main>",
          "  );",
          "}",
          "",
    ].join("\n"),
    "src/pages/hero.css": [
          "/* Hero \u2014 the headline block at the top of the page. */",
          "",
          ".hero {",
          "  padding: 56px 24px 40px;",
          "  text-align: center;",
          "}",
          "",
          ".hero h1 {",
          "  margin: 0 0 14px;",
          "  font-size: 44px;",
          "  line-height: 1.08;",
          "  letter-spacing: -0.03em;",
          "  color: #0f172a;",
          "}",
          "",
          ".hero p {",
          "  margin: 0 auto;",
          "  max-width: 34rem;",
          "  font-size: 17px;",
          "  line-height: 1.6;",
          "  color: #475569;",
          "}",
          "",
          ".hero-logo {",
          "  width: 72px;",
          "  height: 72px;",
          "  margin-bottom: 20px;",
          "  border-radius: 16px;",
          "}",
          "",
    ].join("\n"),
    "src/components/Banner.vue": [
          "<template>",
          "  <section class=\"banner\">",
          "    <h2 class=\"banner-title\">Ship it on Friday</h2>",
          "    <p class=\"banner-body\">Small changes, reviewed like any other pull request.</p>",
          "    <p class=\"banner-count\">{{ deployCount }} deploys this week</p>",
          "  </section>",
          "</template>",
          "",
          "<script setup>",
          "import { ref } from 'vue';",
          "const deployCount = ref(12);",
          "</script>",
          "",
          "<style scoped>",
          ".banner {",
          "  padding: 22px 24px;",
          "  border-radius: 12px;",
          "  background: #f1f5f9;",
          "}",
          ".banner-title {",
          "  margin: 0 0 6px;",
          "  font-size: 19px;",
          "  color: #0f172a;",
          "}",
          "</style>",
          "",
    ].join("\n"),
    "src/components/Features.jsx": [
          "export function Features() {",
          "  return (",
          "    <div className=\"features\" id=\"feature-grid\">",
          "      {/* Each card is its own block, so the three stay",
          "          independent when one of them is edited. */}",
          "",
          "      <div className=\"card\">",
          "        <h3>Blazing fast</h3>",
          "        <p>Optimised for perfomance from day one. No compromises.</p>",
          "      </div>",
          "",
          "      {/* Heading and body are annotated separately. That is what",
          "          lets a single card be rewritten without the codemod",
          "          touching either of its neighbours. */}",
          "      <div className=\"card\">",
          "        <h3>Developer firendly</h3>",
          "        <p>Great DX out of the bocks. Works with your existing tools.</p>",
          "      </div>",
          "",
          "      {/* Duplicating this card is the demo for the structure",
          "          tool's \"duplicate\", so it stays last. */}",
          "",
          "      <div className=\"card\">",
          "        <h3>Scals with you</h3>",
          "        <p>From side project to enterprise. No rewrite required.</p>",
          "      </div>",
          "    </div>",
          "  );",
          "}",
          "",
    ].join("\n"),
  };

  /** A path the demo has no fixture for — say so rather than serve another file. */
  function missingFixture(path) {
    return [
      `// ${path}`,
      "//",
      "// The preview has no stand-in for this file. In the real extension its",
      "// contents come from GitHub, on the branch the page was built from.",
      "",
    ].join("\n");
  }

  // Two owners, so the grouped picker is visible in the demo.
  const FAKE_REPOS = [
    { full_name: "acme/site", private: false },
    { full_name: "acme/marketing", private: true },
    { full_name: "wisdom132/personal-site", private: false },
    { full_name: "wisdom132/notes", private: true },
  ];

  const FAKE_BRANCHES = {
    "acme/site": ["main", "feature/copy-fixes", "staging"],
    "acme/marketing": ["main", "develop"],
    "wisdom132/personal-site": ["main"],
    "wisdom132/notes": ["main"],
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

      if (path.startsWith("/api/file")) {
        const params = new URLSearchParams(path.split("?")[1]);
        const wanted = params.get("path");
        return {
          data: {
            path: wanted,
            sha: `preview-sha-${wanted}`,
            content: SOURCE_FILES[wanted] ?? missingFixture(wanted),
          },
        };
      }

      if (path.startsWith("/api/preview-status")) {
        // Exercises the stale-preview banner.
        return { data: { status: "ahead", behindBy: 2, usable: true } };
      }

      return { error: `preview shim: unhandled path ${path}` };
    }

    if (type === "LOAD_CODE_EDITOR") {
      // The real extension injects this with chrome.scripting into its own
      // isolated world. A plain page has no such world, so the demo loads
      // it with a script tag — same bundle, same global.
      if (globalThis.__IET_CODE_EDITOR__) return { ok: true };

      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "dist/code-editor.js";
        script.onload = resolve;
        script.onerror = () => reject(new Error("could not load dist/code-editor.js"));
        document.head.appendChild(script);
      });

      console.log("[preview] code editor chunk loaded");
      return { ok: true };
    }

    if (type === "RESIZE_WINDOW") {
      // A web page cannot resize the browser window — only the installed
      // extension can, through chrome.windows. Reporting success here made
      // the feature look broken rather than unsupported.
      console.log("[preview] would resize window to", payload.width, "x", payload.height);
      return {
        error:
          "Resizing needs the installed extension \u2014 a web page cannot resize the browser window.",
        unsupported: true,
      };
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
    windows: {
      async getCurrent() {
        return { id: 1 };
      },
      async update() {
        return { id: 1 };
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
