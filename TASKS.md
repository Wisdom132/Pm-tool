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

## Phase 7 — The source editor ✅

For developers, the same gesture that a writer uses to edit copy opens the file
the element was built from. The point is not that an editor runs in the browser
— it is that clicking a rendered heading lands on the line that produced it.

- [x] **7.1** `GET /api/file` returns a file's content and its blob sha. The sha
      travels with the edit and is handed back on commit, so GitHub rejects the
      write if the file changed while the panel was open, rather than silently
      clobbering it.
- [x] **7.2** CodeMirror 6, built as **its own bundle and injected on demand**.
      A content script cannot pull in an extension file with a `<script>` tag —
      that runs in the page's world — so the background worker injects it with
      `chrome.scripting` into the same isolated world, where it registers itself
      on a global. Content script stays 30kB gzipped; the chunk is 162kB and
      never loads for someone editing copy.
- [x] **7.3** Alt-click opens the source whatever tool is active — the gesture is
      the mode, so a developer never has to select one.
- [x] **7.4** The line the element came from is highlighted and scrolled to
      centre. `EditorView` is given the shadow `root`, without which CodeMirror
      measures selection against the document and the caret lands wrong.
- [x] **7.5** Whole-file edits stage keyed by path, so two edits to one file are
      one edit. They commit ahead of the located codemods and are skipped by the
      per-file grouping, which assumes text ranges.
- [x] **7.7** **Edits in the editor show up on the page as they are typed.** The
      page cannot be re-rendered — there is no build in the browser — but the
      parser CodeMirror already loaded for highlighting can say what each JSX
      element on a line now contains, and an annotated element *is* a line in
      a file. So the outline is read back out of the syntax tree and applied
      to every element on the page that came from that file. No extra bytes:
      the parser was already in the chunk.

      Only what can be stated as fact is applied. An element whose children
      include another element or a `{expression}` keeps its text, because
      replacing the text of `<p>Read our <a>guide</a></p>` would delete the
      link. Attributes are applied when their value is a string literal.
      Unparseable source leaves the page on its last good state rather than
      blanking it.

      An element that already carries an edit from another tool is the one
      real conflict here. The rescan that follows any DOM write re-applies
      pending element edits, which put the old text straight back over the
      preview — typing in the editor looked like it did nothing. While the
      panel is open the source wins; on stage it *supersedes* those edits and
      says how many it replaced. Without that the file would commit first and
      the element's codemod would then run on top of it, quietly undoing what
      was typed in the editor. Discard keeps them.

      Discard restores everything; staging keeps it. The panel reserves its
      own height as page padding and scrolls the element into the strip above
      itself — a short page is otherwise already scrolled to its end and
      cannot lift the element out from behind the panel.
- [x] **7.8** **Stylesheets, one tab each.** A component's styles are wherever it
      imports them from, so the file itself is the index: the import statements
      are scanned, each stylesheet is fetched, and each gets a tab. Editors are
      built on first view, so an unopened tab costs nothing. Each changed file
      stages as its own whole-file edit, which `create-pr` already handles.

      Specifiers that are not relative are skipped: a bare one is a package,
      and `/styles/x.css` is served from a public directory with no fixed place
      in the repository. Opening the wrong file is worse than opening none.

      CSS previews *exactly*, unlike markup — it is declarative and the browser
      already knows how to run it. The edited file is appended last so it wins
      at equal specificity, and where the original sheet can be identified by
      name it is switched off, so removing a rule takes effect too and not only
      adding one. On a bundled preview build that identification will often
      fail, which makes the preview additive-only; a deletion then shows up in
      the PR but not on the page.

      When a component imports no stylesheet — Tailwind, CSS-in-JS, a global
      sheet — the tab says so and names what it looked for. If the element's
      classes look like utility classes it says that instead, and points at the
      markup tab and the Properties tool, which are where that styling actually
      lives.
- [x] **7.9** **Frameworks other than React.** The live preview read the syntax
      tree for `JSXElement` only, so on a Vue SFC or an Angular template it did
      nothing — and did it silently, which is the worst way to not work. JSX and
      HTML produce the same shape of tree under different node names, so one
      walker now serves both.

      Two things HTML has no node for had to be recognised by hand. `{{ expr }}`
      is plain text to the parser, and writing it to the page would replace a
      rendered value with the expression that produced it. Bound attributes —
      `v-bind`/`:href`, `[href]`, `(click)`, `*ngIf`, `@click` — hold code, not
      literals, and are skipped for the same reason.

      Vue and Svelte keep styles in the component file, so there is no
      stylesheet to import: the `<style>` block is extracted and previewed as
      CSS alongside the template. `scoped` cannot be reproduced — the compiler
      rewrites those selectors with a per-component attribute that does not
      exist until build — so it previews unscoped and the footer says so.
- [x] **7.6** The review panel renders them as `path · +N −M lines` rather than a
      text diff — there is no before/after phrase to mark up, and rendering the
      placeholder as one reads like a bug. The counts are computed at stage
      time, the only point that still holds both versions.

## Phase 8 — Svelte ✅

- [x] **8.1** Annotation plugin for Svelte and SvelteKit. A `.svelte` file is
      markup at the top level, so offsets in the file are offsets in the markup
      — no template wrapper to correct for, unlike Vue.
- [x] **8.2** **No peer dependency.** `svelte/compiler` changed its AST between
      Svelte 4 (`html`, `Element`) and 5 (`fragment`, `RegularElement`), and a
      plugin that silently stops annotating on a major upgrade is worse than one
      that never depended on the version. It also keeps another multi-megabyte
      dependency out of the package — the one already recorded as a cost gap.
- [x] **8.3** `<script>` and `<style>` bodies are blanked before scanning, with
      offsets and lines preserved. A `<p>` in a string literal is not markup.
      Every Svelte component has a script block, so this is not an edge case,
      and the same masking was added to the **HTML codemod**, which had none —
      it would eventually have rewritten code as if it were copy.
- [x] **8.4** Depth-aware close-tag matching, so a `<span>` inside a `<span>`
      does not end the outer one.
- [x] **8.5** `.svelte` routes to the HTML codemod backend, so edits commit.
      The interpolation guard now covers a single `{expr}` as well as `{{ }}`:
      replacing `{count} deploys` with static text would drop a live value.
- [x] **8.7** **Tested against a real Vite build**, not fixture strings. A
      minimal Svelte app is built in memory with `@sveltejs/vite-plugin-svelte`
      and the annotations are asserted in the emitted bundle, so "the plugin
      loads but does nothing" cannot pass — the failure mode this repo has
      hit twice. It also covers the case that matters most in production: with
      `INLINE_EDIT` unset the bundle contains no annotations at all, so a
      deploy cannot leak source paths to anyone who views source.

      This is the first of the four plugins with real-build coverage; React,
      Vue and Angular still have none.
- [x] **8.6** A **round-trip test**: every line the annotator stamps is resolved
      back through the codemod. Nothing else checks that the writer and the
      reader agree on what a line number means, and the Vue plugin shipped with
      template-relative numbers against a file-absolute reader for exactly that
      reason.

## Phase 9 — Examples ✅

- [x] **9.1** `examples/` — one minimal app per framework, each rendering the
      same component and wired to its plugin the way a real project would be.
      Every `Banner` covers the same five cases: plain text, text with an
      existing attribute, text mixed with expressions, a nested editable, and
      markup inside a string in the script block.
- [x] **9.2** `tests/annotation-build.test.js` runs the **real bundler** over
      react/, vue/ and svelte/, using each example's own `vite.config.js` — so
      the wiring in the README is the wiring under test. Also asserts that
      without `INLINE_EDIT` the bundle carries no annotations at all.
- [x] **9.3** **It immediately found the Vue plugin broken.** Current
      `@vue/compiler-sfc` reports `template.loc.start.offset` as the block's
      *content*; the plugin scanned forward from it for `>` regardless, which
      landed every insertion past the first child element — attributes in the
      middle of the next tag's text, `{{ label.length }}` split into
      `{{ la` + attributes + `bel.length }}`, and a build that failed outright.
      It now asks the source which convention is in play rather than pinning a
      version. Regression tests at both unit and build level.

      This had been shipping since the compiler-sfc update. Fixture tests
      passed throughout, which is the whole argument for this phase.
- [x] **9.4** The three plugins deliberately annotate *different* sets, and the
      build test asserts each exactly. A plugin should annotate only what its
      codemod can edit safely: JSX and Vue rewrite a single text node, so
      copy mixed with `{expr}` is editable; Svelte routes to the HTML codemod,
      which replaces a whole inner range, so those elements are skipped.
      Annotating what cannot be committed offers an edit that fails silently
      at PR time.
- [x] **9.5** **The editor runs on the examples**, the way it does on the
      extension's own demo — one Vite plugin injects the built content script
      and a chrome.* shim into each example page in dev.

      The difference from `preview.html` is that `/api/file` reads the real
      file from the working tree rather than a canned fixture, so opening a
      component shows what actually rendered the page and an edit previews
      against it. The extension is served from `dist/` rather than copied, so
      a rebuild needs nothing kept in sync; if it has not been built, the page
      says so instead of failing quietly.

      Responsive preview and opening a pull request both report plainly that
      they need the installed extension, rather than appearing to work. Dev
      only — a production build of an example ships no editor, and that is
      asserted.
- [ ] **9.6** Angular is source files and a config excerpt, not a runnable app:
      a real workspace plus `@angular-builders/custom-webpack` outweighs every
      other dependency here. Its annotator is unit tested; **its wiring is
      not** — the same gap that hid the Vue bug.

## Phase 6 — Ship ✅

- [x] **6.1** README + per-framework install guides (currently only doc comments)
- [x] **6.2** Deployment guide for the pr-service with an env var reference
- [x] **6.3** Structured logging wired to an optional error sink. Sentry loads
      dynamically only when `SENTRY_DSN` is set and the package is installed; a
      missing or broken sink never affects a request.
- [x] **6.4** Annotation package made publishable — `files`, `exports`, licence,
      keywords, its own README, `npm pack` verified at 9 files / 9.9 kB.
      Publishing itself is yours to run: `npm publish --prefix annotation`

---

## Known gaps

Not defects with a fix pending — deliberate trade-offs or unfinished coverage,
recorded so they are not rediscovered as surprises.

### Verification

- [ ] No end-to-end coverage for the **side panel**. It needs a real extension
      context, so it is exercised by hand only.
- [ ] **Angular's plugin has no real-build coverage.** React, Vue and Svelte
      are built for real by `npm run test:examples`; Angular needs a webpack
      workspace and is still fixture-tested only. This is the exact gap that
      hid a broken Vue plugin, so treat Angular as the least verified.
- [ ] `next build` for the service **fails at "Collecting build traces"** with
      `ERR_INVALID_ARG_TYPE` from Next 14.2's bundled `@vercel/nft`. Pre-existing
      — it reproduces on a clean checkout of HEAD and on Node 20 as well as 24,
      and is not caused by any application file (bisected). Compilation and page
      generation both succeed and `next dev` is unaffected, so it blocks only the
      trace manifest a serverless deploy prunes with. Fix is most likely a Next
      upgrade; deliberately not attempted as part of the editor work.

### Cost and weight

- [ ] `@vue/compiler-sfc` is a hard dependency of the service (~3MB) even for a
      JSX-only project. Now genuinely required — the codemod imports it
      statically — but it could be split behind a runtime check.
- [ ] The i18n resolver **reads every candidate locale file on each pull
      request**. Fine for a handful; wasteful for a per-namespace locale tree.
- [ ] `/api/locate` resolves line numbers by fetching the top few search hits.
      One call each, uncached.

### Operational

- [ ] The session store **defaults to process memory**. It warns in production
      and `docs/DEPLOYMENT.md` explains it, but it is the single most likely
      cause of a confusing first deployment.
- [ ] The responsive tool **resizes the user's real browser window**. There is
      no sandboxed viewport available to an extension without the debugger
      permission, which is a worse trade.
