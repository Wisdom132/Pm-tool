# Inline Edit Tool — Roadmap

**Product decision:** this is a **preview-deploy tool**. Editors (PMs, writers, designers)
open a staging/preview URL — a Vercel/Netlify/Amplify preview build — click text, and submit
a pull request. It is *not* a localhost-only dev tool.

Three consequences drive the plan below:

1. **Build metadata must come from CI env vars.** Vercel, Netlify and Amplify all build from
   a shallow clone in detached HEAD state, so `git rev-parse --abbrev-ref HEAD` returns
   `"HEAD"`. Some build environments ship no `.git` at all.
2. **Runtime framework introspection is unavailable.** Preview builds are production React /
   Vue, so `_debugSource` and `__vueParentComponent` are stripped. The build-time annotation
   plugin is mandatory, which makes the connected/observer split a hard boundary.
3. **Editors may not have push access.** A reviewer with read-only repo access cannot create a
   branch, so the GitHub App migration is load-bearing rather than just a security upgrade.

---

## Phase 0 — Cleanup ✅

Unblocks everything else. No behaviour change beyond one bug fix.

- [x] **0.1** Delete unused `next-auth` dependency and the two 404 tombstone routes
      (`pages/api/extension-token.js`, `pages/api/auth/[...nextauth].js`)
- [x] **0.2** Replace ad-hoc `console.log` calls with a structured logger
      (`repos.js:7`, the `[find]` logs in `lib/github.js`, `[create-pr]` in `create-pr.js`)
- [x] **0.3** Fix the whitespace bug in `confirmEdit` (`content.js:337`) — `originalText` is
      stored untrimmed but compared against a trimmed `newText`, producing phantom edits that
      then fail to patch
- [x] **0.4** Test infrastructure (Vitest) + GitHub Actions CI running tests and an extension build
- [x] **0.5** Unit tests for the pure functions: `applyTextEdit`, `buildCommitMessage`,
      `buildPrBody`, `annotateSource`, `annotateInlineTemplates`, `findTemplateContentOffset`

## Phase 1 — Make preview deploys work ✅

- [x] **1.1** Shared `buildInfo` module resolving branch / commit SHA / repo from CI env vars,
      with a fallback chain: Vercel (`VERCEL_GIT_COMMIT_REF`, `VERCEL_GIT_COMMIT_SHA`,
      `VERCEL_GIT_REPO_OWNER`, `VERCEL_GIT_REPO_SLUG`) → Netlify (`BRANCH`, `COMMIT_REF`,
      `REPOSITORY_URL`) → Amplify (`AWS_BRANCH`, `AWS_COMMIT_ID`) → GitHub Actions
      (`GITHUB_REF_NAME`, `GITHUB_SHA`, `GITHUB_REPOSITORY`) → Cloudflare Pages
      (`CF_PAGES_BRANCH`, `CF_PAGES_COMMIT_SHA`) → `git rev-parse`
- [x] **1.2** Decouple annotation from `NODE_ENV`; gate all three plugins on an explicit
      `INLINE_EDIT=1` flag (`react/index.js:56`, `vue/index.js:141`, `angular/webpack.config.js:20`)
- [x] **1.3** Stamp `data-edit-commit` and `data-edit-repo` on `<html>` alongside `data-edit-branch`
- [x] **1.4** Auto-resolve repo + branch in the extension from those attributes; collapse the two
      pickers into a confirmable one-liner with manual override
- [x] **1.5** Keep `detectBranch()` URL patterns as the fallback path and cover them with tests
      (`content.js:790`)
- [x] **1.6** CI guard failing the build if `data-edit-*` attributes appear in a production bundle
      — annotations leak source paths and must never ship to production
- [x] **1.7** HTTPS-first service URL: drop the `http://localhost:3001` production default,
      validate in the popup, keep localhost for dev only
- [x] **1.8** Branch from the preview's exact commit rather than the base branch tip, and target
      the preview's own branch as the PR base so the diff matches what the editor saw
- [x] **1.9** Stale-preview detection — warn when `data-edit-commit` is not an ancestor of the
      branch tip

## Phase 2 — Auth & security ✅

- [x] **2.1** Migrate OAuth App → GitHub App (per-repo installation, short-lived tokens,
      org admin approval, per-installation rate limits)
- [x] **2.2** Stop embedding the raw GitHub token in the JWT (`extension-callback.js:41`);
      server-side session store, opaque session ID to the extension, expiry in days not a year
- [x] **2.3** Move the session ID from `chrome.storage.sync` to `chrome.storage.local`
- [x] **2.4** Issue and verify a signed single-use `state` nonce (`extension-callback.js:8`)
- [x] **2.5** Allowlist `ext_id` against registered extension IDs to close the open redirect
- [x] **2.6** Replace `Access-Control-Allow-Origin: *` with a `chrome-extension://<id>` allowlist
      (`middleware.js:4`)
- [x] **2.7** Rate-limit `/api/create-pr` per installation and per user
- [x] **2.8** Open PRs as the App on behalf of the user, so editors without push access can submit

## Phase 3 — Extension robustness ✅

- [x] **3.1** Move the entire UI into a closed shadow root (`overlay.css` currently injects
      global rules onto every page)
- [~] **3.2** Side panel added (`sidepanel.html`) owning the cross-page session list,
      edit-mode toggle and undo/redo. The review/submit modal deliberately stays
      in-page: it needs the repo/branch/commit annotations on that document, and
      `chrome.sidePanel.open()` needs a user gesture a content script cannot supply.
      The in-page toolbar remains for editing without opening the panel.
- [x] **3.3** `MutationObserver` re-scan — SPA re-renders currently destroy listeners, the dirty
      highlight, and the `pendingEdits[].element` references Undo depends on (`content.js:139`)
- [x] **3.4** Replace direct `contentEditable` with an overlay editing surface; React clobbers
      typed text on re-render
- [x] **3.5** Persist sessions across navigation in `chrome.storage.local` so one PR can span
      multiple pages
- [x] **3.6** Element breadcrumb / tree selector — also fixes nested elements being unreachable
      through the capture-phase click handler (`content.js:185`)
- [x] **3.7** Undo/redo stack with keyboard shortcuts
- [x] **3.8** Replace `preview.html`'s ~500 forked lines with the real `content.js` plus a
      `chrome.*` shim; reuse it as the E2E harness
- [x] **3.9** Playwright E2E covering edit → submit against a mock GitHub

> **v1 cut line.** Everything above ships a trustworthy, secure, installable tool that does text
> edits well on preview deploys. Phase 4 is the substrate for everything after it — building
> Tailwind editing on top of string-replace would be rework.

## Phase 4 — Patcher substrate ✅

- [~] **4.1** Superseded by a ranked locator (`lib/codemod/locate.js`): exact line+column →
      same line → within 3 lines → unique text match. Structural IDs were rejected because
      all three build plugins would have to generate the path identically and the server
      re-derive it, and the path breaks whenever anyone wraps an element in a new container.
      A text match degrades better — the text is what the editor actually changed.
- [x] **4.2** Replace `applyTextEdit`'s ±2-line string replace with an AST codemod —
      `recast`/`magic-string` for JSX, `@vue/compiler-sfc` for Vue
- [x] **4.3** Resolve edits against the build commit's tree, then rebase onto the branch tip with
      explicit conflict reporting
- [x] **4.4** Single AST pass for multi-edit files instead of sequential string mutation
      (`create-pr.js:78`)
- [x] **4.5** Route i18n edits to locale files — text rendered from `t('hero.title')` must patch
      the JSON, not the component

## Phase 5 — UI and editing tools ✅

Reshaped from the original feature list: the priority became the interface.
The model is VisBug's — a floating vertical rail of tools, one active at a
time, deciding what a click on the page does.

- [x] **5.1** Floating tool rail (`src/ui/rail.js`) replacing the bottom toolbar:
      tools, actions, tooltips, pending-edit count badge, keyboard shortcuts
- [x] **5.2** Hand-built icon set (`src/ui/icons.js`), drawn with `createElementNS`
      so no UI string is ever parsed as markup
- [x] **5.3** Element labels (`src/ui/labels.js`) — `<tag>.classes` + `File.tsx:12`
      + an i18n chip, in the manner of VisBug's tag badges
- [x] **5.4** Inspect tool: hover shows provenance, click opens a detail card listing
      exactly what the service will be told about that edit
- [x] **5.5** Design system in `ui.css` — magenta for what you are acting on,
      violet for what you are pointing at, emerald for what you already changed
- [x] **5.6** Dock-side switch: the rail floats over the page and would otherwise
      cover the very text being edited. Click the brand to flip sides; remembered
      in `chrome.storage.sync`
- [x] **5.7** Toast notifications replacing the permanent status strip
- [x] **5.8** Screenshot harness (`scripts/screenshot-ui.mjs`) — the UI lives in a
      closed shadow root and cannot be inspected from the page, so rendering is
      verified by capturing each state
- [x] **5.9** 33 UI unit tests + 6 tool-model E2E tests

### Product boundary

- [x] **5.10** Observer mode — an unannotated page files an issue rather than guessing
      at source files
- [x] **5.11** `findTextInRepo` retired. Replaced by `/api/locate`: one code-search call,
      ranked candidates, confirmed by a human before anything is written. The old path
      made one API call per source file per edit and committed to whatever a model
      picked. The Anthropic dependency went with it.
- [x] **5.15** Word-level source diff in the review panel

### Editing tools

- [x] **5.12** Attribute editing — `alt`, `href`, `title`, `aria-label`, `placeholder`,
      `src`, via a Properties tool. Only attributes already written in the source are
      offered: the codemod rewrites an existing string literal, and inventing one would
      be a different change than the editor thinks they are making.
- [x] **5.13** Class editing with chips and autocomplete. Suggestions come from classes
      already used on the page — more relevant than a generic utility list, and free in
      bundle size. Our own `__iet-*` decorations are never written to source.
- [x] **5.14** Image replacement. The file is read in the browser, carried with the edit,
      and committed as a binary blob *before* the source change that points at it, so the
      branch is never briefly broken. Capped at 512kB.
- [x] **5.16** Structural ops — move up/down, duplicate, delete. Applied as an AST pass of
      their own so their ranges cannot collide with a text or attribute rewrite inside the
      element being moved. Requires a build annotation: there is no text to fall back on
      when locating an element, and deleting the wrong node cannot be undone by retyping.
- [x] **5.17** Responsive preview. Resizes the browser window rather than scaling the page
      — media queries answer to the viewport, so a scaled "mobile" preview would still
      render desktop breakpoints and test nothing.

## Phase 6 — Ship ✅

- [x] **6.1** README + per-framework install guides (currently only doc comments)
- [x] **6.2** Deployment guide for the pr-service with an env var reference
- [x] **6.3** Structured logging wired to an optional error sink. Sentry loads
      dynamically only when `SENTRY_DSN` is set and the package is installed; a
      missing or broken sink never affects a request.
- [x] **6.4** Annotation package made publishable — `files`, `exports`, licence,
      keywords, its own README, `npm pack` verified at 9 files / 9.9 kB.
      Publishing itself is yours to run: `npm publish --prefix annotation`
