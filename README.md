# Inline Edit Tool

Click text on a preview deployment, rewrite it in place, and open a pull
request against the source file it came from.

Built for the people who notice the typo but don't open the repo — writers,
PMs, designers reviewing a staging build. They edit what they see; the tool
works out which file to change and opens a PR for a developer to merge.

```
  preview deploy                 browser extension              pr-service
 ┌────────────────┐            ┌──────────────────┐         ┌──────────────┐
 │ data-edit-file │──stamped──▶│ click, type,     │──POST──▶│ codemod →    │
 │ data-edit-line │  at build  │ review           │         │ branch → PR  │
 │ data-edit-repo │            └──────────────────┘         └──────┬───────┘
 └────────────────┘                                                │
        ▲                                                          ▼
        └────────────── annotation plugin ──────────────────  GitHub App
```

---

## The idea

The hard part is not the editing UI — it is knowing that the heading you
clicked came from `src/components/Hero.tsx:12`.

A build-time **annotation plugin** stamps that onto the DOM. The extension
reads it, the service patches exactly that spot with an AST codemod, and the
diff in the resulting PR contains nothing but the words that changed.

Pages without annotation still work, but honestly: the extension will offer
to search for the text and ask you to confirm the file, or file the edits as
an issue. It will not guess and commit.

---

## Repository layout

| Path | What it is |
|------|------------|
| `annotation/` | Build plugins for React, Vue and Angular. Stamp `data-edit-*` onto the DOM. |
| `inline-edit-tool/extension/` | Chrome MV3 extension: tool rail, inline editing, review panel. |
| `overlay/pr-service/` | Next.js service: GitHub App auth, codemods, opens PRs. |
| `tests/` | Unit tests (Vitest) and end-to-end tests (Playwright). |

---

## Try it in two minutes

No install, no GitHub, no configuration:

```bash
npm install
npm run preview          # → http://localhost:4173/preview.html
```

This runs the real extension build against a stubbed `chrome.*` API on a demo
page. Pick the pencil in the rail and click any text. "Re-render page"
replaces the DOM the way a framework does — your edits should survive it.

---

## Setting it up for real

### 1. The service

```bash
cp overlay/pr-service/.env.example overlay/pr-service/.env.local
# fill it in — see docs/DEPLOYMENT.md
npm run dev:svc          # → http://localhost:3001
```

You need a **GitHub App** (not an OAuth App). `.env.example` lists the exact
permissions. Writes go through an installation token, which is what lets an
editor with only read access open a pull request.

### 2. The extension

```bash
npm run build:ext
```

Then `chrome://extensions` → Developer mode → **Load unpacked** →
`inline-edit-tool/extension/dist`.

Open the popup and set the service URL. Anything other than `localhost` must
be `https://` — the extension sends a bearer token to that origin.

### 3. The annotation plugin

This is what makes edits land in the right file. Pick your framework below.

**Preview deployments must build with `INLINE_EDIT=1`.** Annotations expose
your source layout, so they must never ship to production — CI enforces this,
see `scripts/check-no-annotations.mjs`.

---

## Annotation plugins

All three stamp the same attributes and are inert unless `INLINE_EDIT` is
truthy (or you are running a dev server).

<details>
<summary><b>React / Next.js</b></summary>

`.babelrc`:

```json
{
  "presets": ["next/babel"],
  "plugins": ["./annotation/react/index.js"]
}
```

Vite + React, in `vite.config.js`:

```js
import { babel } from '@rollup/plugin-babel';

export default {
  plugins: [
    react(),
    babel({ plugins: ['./annotation/react/index.js'] }),
  ],
};
```

Also detects `{t('hero.title')}` and records the key, so translated copy is
patched in the locale file rather than the component.
</details>

<details>
<summary><b>Vue / Nuxt</b></summary>

`vite.config.js`:

```js
import inlineEdit from './annotation/vue/index.js';

export default { plugins: [vue(), inlineEdit()] };
```

`nuxt.config.ts`:

```ts
import inlineEdit from './annotation/vue/index.js';

export default defineNuxtConfig({ vite: { plugins: [inlineEdit()] } });
```
</details>

<details>
<summary><b>Angular</b></summary>

Requires `@angular-builders/custom-webpack`:

```bash
ng add @angular-builders/custom-webpack
```

`angular.json`, under `architect.build.options`:

```json
{
  "customWebpackConfig": {
    "path": "./annotation/angular/webpack.config.js",
    "mergeStrategies": { "module.rules": "prepend" }
  }
}
```
</details>

### Build metadata

The plugins also stamp the branch, commit and repository onto `<html>`, read
from CI environment variables — Vercel, Netlify, GitHub Actions, Amplify,
Cloudflare Pages and Render are detected automatically.

This matters because build hosts check out a **detached HEAD**, so
`git rev-parse --abbrev-ref HEAD` returns the literal string `"HEAD"`. Git is
only used as a last resort locally.

Override with `INLINE_EDIT_BRANCH`, `INLINE_EDIT_COMMIT`, `INLINE_EDIT_REPO`.

---

## Using it

| | |
|---|---|
| **Crosshair** | Hover to see where text comes from; click for full detail |
| **Pencil** | Click any text to rewrite it |
| **Grid** | Toggle alignment guides |
| **Changes / PR** | Review everything and open a pull request |
| **IE badge** | Move the rail to the other side |

`e` and `i` switch tools, `⌘Z` / `⇧⌘Z` undo and redo.

Edits persist across navigation, so you can walk several pages of a preview
and submit them as one pull request. The side panel lists everything pending
and lets you discard individual edits.

### What it does with a stale preview

Previews are built from a commit that may no longer be the branch tip. The
service branches from the **exact commit the preview was built from**, so the
diff contains only your changes and Git handles the merge. If the branch was
rebased since, you are warned before submitting.

---

## Development

```bash
npm install              # root: test tooling
npm run install:all      # extension + service dependencies

npm run dev              # extension watcher + service together
npm test                 # unit tests
npm run test:e2e         # Playwright, against the real build
npm run preview          # demo page
```

`scripts/screenshot-ui.mjs` captures every UI state — the chrome lives in a
closed shadow root and cannot be inspected from the page, so screenshots are
how rendering gets verified.

See [TASKS.md](TASKS.md) for the roadmap and what is deliberately not done.

---

## Security

- The extension holds an **opaque session ID**; GitHub tokens stay server-side,
  AES-256-GCM encrypted, expiring in 14 days.
- OAuth `state` is a server-issued single-use nonce, and the redirect target
  comes from that nonce rather than the query string.
- Only extension IDs in `ALLOWED_EXTENSION_IDS` may authenticate, and CORS is
  restricted to those origins.
- Pull requests are opened by the GitHub App with the editor named in the body.

Report anything you find privately rather than opening an issue.
