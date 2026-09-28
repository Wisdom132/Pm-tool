# Inline Edit Tool

Click text on a preview deployment, rewrite it in place, and open a pull
request against the source file it came from.

Built for the people who notice the typo but don't open the repo — writers,
PMs, designers reviewing a staging build. They edit what they see; the tool
works out which file to change and opens a PR for a developer to merge.

```
  preview deploy                 browser extension                  API
 ┌────────────────┐            ┌──────────────────┐         ┌──────────────┐
 │ data-edit-file │──stamped──▶│ click, type,     │──POST──▶│ codemod →    │
 │ data-edit-line │  at build  │ review           │         │ branch → PR  │
 │ data-edit-col  │            └──────────────────┘         └──────┬───────┘
 └────────────────┘                                                │
        ▲                                     ┌──────────────┐     ▼
        └───────── annotation plugin           │  dashboard   │  GitHub App
                                               │ sites, teams │──installed
                                               │ connections  │  per org
                                               └──────────────┘
```

The page no longer says which repository it belongs to. It says which
*hostname* it is on; the dashboard's site registry turns that into a
repository and a branch. A page cannot name a repository its editors were
never granted.

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
| `apps/api/` | NestJS API: accounts, sites, provider connections, codemods, opens PRs. |
| `apps/dashboard/` | Angular dashboard: sign-in, sites, teams, connections. |
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

### 1. The API

```bash
createdb inline_edit
cp apps/api/.env.example apps/api/.env
# fill it in — see docs/DEPLOYMENT.md
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
npm run check:env        # says which values are still missing
npm run dev:api          # → http://localhost:3333/api
```

Needs **Node 22.12 or newer**: the codemods import `@babel/parser` 8, which
is ESM-only, and the build is CommonJS. An older runtime builds fine and then
fails on the first JSX edit.

You also need a **GitHub App** (not an OAuth App). `apps/api/.env.example`
lists the exact permissions; `npm run install:key` puts the private key in
place, and `npm run check:github` proves the credentials work before a
browser is involved. Writes go through an installation token, which is what
lets an editor with only read access open a pull request.

### 2. The extension

```bash
npm run build:ext
```

Then `chrome://extensions` → Developer mode → **Load unpacked** →
`inline-edit-tool/extension/dist`.

Open the popup and set the service URL. Anything other than `localhost` must
be `https://` — the extension sends a bearer token to that origin.

> **Note:** the extension still speaks the old service's protocol and has not
> yet been repointed at `/api/editing/*`. See `TASK.md`.

### 2b. The dashboard

```bash
npm run dev:dashboard    # → http://localhost:4200
```

Sign in, connect GitHub, then register a site: `hostname → repository →
branch`. That mapping is what the extension resolves against.

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
npm install              # root + workspaces (apps/api, apps/dashboard)
npm run install:all      # extension dependencies

npm run dev              # extension watcher + API together
npm test                 # unit tests
npm run test:e2e         # Playwright, against the real build
npm run preview          # demo page
```

`scripts/screenshot-ui.mjs` captures every UI state — the chrome lives in a
closed shadow root and cannot be inspected from the page, so screenshots are
how rendering gets verified.

See [TASKS.md](TASKS.md) for the engineering log and [TASK.md](TASK.md) for
the platform roadmap and what is deliberately not done.

---

## Security

- **No provider token ever reaches the browser.** The extension holds a
  session for *us*, not for GitHub. Installation tokens are minted
  server-side, per organisation, and cached in memory only.
- Stored provider credentials are **AES-256-GCM** encrypted at rest with a
  versioned key, so rotation needs no migration. A GitHub App connection
  stores no secret at all — the installation id is not sensitive.
- The install redirect carries a **signed, ten-minute `state`** binding the
  installation to the organisation that asked for it. Without it, whoever
  completes an install chooses which organisation it lands in.
- **Every query is organisation-scoped**, and "not a member" is
  indistinguishable from "does not exist" so neither can be used to
  enumerate the other.
- **The client cannot name a repository.** Editing endpoints take a site
  environment id and derive the repository, branch and connection from the
  registry, checked against the caller's team access.
- Source paths from a page are validated as a per-segment allowlist before
  any write — percent-encoded traversal and absolute paths included.
- Pull requests are opened by the GitHub App with the editor named by display
  name, never by email address: a change request can land in a public
  repository.

Report anything you find privately rather than opening an issue.
