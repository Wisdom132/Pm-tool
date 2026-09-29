# Inline Edit Tool

Click text on a preview deployment, rewrite it in place, and open a pull
request against the source file it came from.

Built for the people who notice the typo but don't open the repo — writers,
PMs, designers reviewing a staging build. They edit what they see; the tool
works out which file to change and opens a PR for a developer to merge.

```
                        ┌─── build time ───┐
   your repository ────▶│ annotation plugin│────▶  preview deploy
                        └──────────────────┘       data-edit-file
                                                   data-edit-line
                                                   data-edit-col
                                                          │
                     who is looking at that page?         │
        ┌─────────────────────────────────────────────────┴───┐
        │                                                     │
 ┌──────▼───────┐                                    ┌────────▼────────┐
 │  extension   │  your team                         │     widget      │  everyone else
 │  edit · move │  signed in, can change things      │  comment only   │  no account
 │  comment     │                                    │                 │
 └──────┬───────┘                                    └────────┬────────┘
        │                                                     │
        └──────────────────────┬──────────────────────────────┘
                               ▼
                      ┌─────────────────┐
                      │       API       │  codemod → branch → pull request
                      │  sites · teams  │  feedback → inbox
                      │  connections    │
                      └───┬─────────┬───┘
                          │         │
                 ┌────────▼───┐  ┌──▼──────────┐
                 │ dashboard  │  │ GitHub App  │
                 │ inbox,     │  │ installed   │
                 │ sites,     │  │ per org     │
                 │ people     │  └─────────────┘
                 └────────────┘
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

## The parts

Five pieces, each doing one job. The first is the reason any of the rest
works.

### 1. Annotation plugins — `annotation/`

Build-time plugins for **React, Vue, Svelte and Angular**. They stamp
`data-edit-file`, `data-edit-line` and `data-edit-col` onto the DOM, so the
heading you clicked can be traced to `src/components/Hero.tsx:12`.

Inert unless `INLINE_EDIT` is set. Annotations describe your source layout,
so they must never reach production — CI enforces that.

This is the part everything else depends on, and the part worth reading
first if you are going to read one.

### 2. The extension — `inline-edit-tool/extension/`

Chrome MV3, for **your team**: people who are signed in and allowed to change
things. A tool rail down the side of any annotated page.

| Tool | What it does |
|---|---|
| **Inspect** | Hover to see where anything came from; click for full detail |
| **Edit text** | Click any text and rewrite it in place |
| **Properties** | Links, alt text and classes |
| **Rearrange** | Move, duplicate or delete an element |
| **Comment** | Leave a note instead of a change — pinned to the source line |

Edits persist across navigation, so you can walk several pages of a preview
and submit them as one pull request.

### 3. The widget — `widget/`

One script tag, for **everyone else**: a client reviewing staging, a customer
who spotted a typo, a tester who will never install anything. No account, no
sign-in.

```html
<script src="https://your-dashboard/widget.js"
        data-api="https://your-api/api" defer></script>
```

Comment only — it cannot change anything. But a comment left through it
carries the same element and source line the extension's would, without the
person leaving it knowing any of that exists.

14KB, no dependencies, and **off by default per site**: switching it on opens
an endpoint anyone can post to, so that is a decision somebody makes rather
than a consequence of registering a site.

### 4. The API — `apps/api/`

NestJS and Postgres. Accounts, organisations, teams, provider connections,
the site registry, the codemods, and the feedback inbox.

Every database call lives in a `*.repository.ts`, every query is
organisation-scoped, and the client never names a repository — it names a
site environment, and the registry derives the rest.

### 5. The dashboard — `apps/dashboard/`

Angular. Where an admin connects GitHub and registers sites, and where
everybody reads the **feedback inbox**: triage a comment, give it an owner,
and turn it into an issue on the repository behind that site — carrying the
page, the element and the source line across.

---

## Repository layout

| Path | What it is |
|------|------------|
| `annotation/` | Build plugins: React, Vue, Svelte, Angular, plus a Nuxt module. |
| `inline-edit-tool/extension/` | Chrome MV3 extension: tool rail, inline editing, review panel. |
| `widget/` | The embeddable public feedback widget. One file, no dependencies. |
| `apps/api/` | NestJS API: accounts, sites, connections, codemods, feedback. |
| `apps/dashboard/` | Angular dashboard: sites, people, teams, the feedback inbox. |
| `examples/` | One minimal app per framework, used by the annotation tests. |
| `scripts/` | Preview server, environment checks, CI guards. |
| `tests/` | Unit tests (Vitest) and end-to-end tests (Playwright). |
| `docs/` | Deployment and operational notes. |

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

### 2b. The dashboard

```bash
npm run dev:dashboard    # → http://localhost:4200
```

Sign in, connect GitHub, then register a site: `hostname → repository →
branch`. That mapping is what the extension and the widget both resolve
against.

The dashboard is also where feedback lands. **Feedback →** a comment, who
owns it, and a button that opens an issue on the repository behind its site.

### 2c. The public widget (optional)

Only if you want people without accounts to be able to comment.

```bash
npm run build:widget     # also copies it into the dashboard's assets
```

Then in the dashboard, open the site and switch **Public feedback widget**
on. It is off by default, and it will not collect anything until the site's
domain is verified — otherwise anyone could register `yourdomain.com` and
receive feedback meant for you.

The dashboard shows the exact tag to paste, which is one line and needs no
site id.

### 3. The annotation plugin

This is what makes edits land in the right file. Pick your framework below.

**Preview deployments must build with `INLINE_EDIT=1`.** Annotations expose
your source layout, so they must never ship to production — CI enforces this,
see `scripts/check-no-annotations.mjs`.

---

## Annotation plugins

All four stamp the same attributes and are inert unless `INLINE_EDIT` is
truthy (or you are running a dev server). A parity test runs equivalent
markup through every one of them, because they had silently diverged once
and nothing caught it.

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
<summary><b>Svelte / SvelteKit</b></summary>

`vite.config.js`:

```js
import inlineEdit from './annotation/svelte/index.js';

export default { plugins: [inlineEdit(), sveltekit()] };
```

Before `sveltekit()`, so it sees the markup rather than the compiled output.
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

### Translated copy

Text rendered through a translation function has no literal in the component,
so patching the component would be wrong twice over — the words are not there
to change, and the other languages would drift from the source one.

All four plugins recognise the idiom and record the key as
`data-edit-i18n-key`: `t('k')`, `$t('k')`, `i18n.t('k')`, `$_('k')`, and
Angular's `'k' | translate`. The edit is then redirected to the locale file
that actually holds the text.

Anything it cannot read back as a literal key — a computed key, a template
literal, a conditional — is refused rather than guessed. A wrong key lands
the edit in the wrong entry of a locale file, and nothing in the resulting
pull request would look out of place.

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

The five tools are listed under **The parts**, above. Alongside them in the
rail:

| | |
|---|---|
| **Guides** | Toggle alignment guides |
| **Changes** | Review everything pending and open a pull request |
| **IE badge** | Move the rail to the other side |

`i` and `e` toggle Inspect and Edit; `⌘Z` / `⇧⌘Z` undo and redo.

Edits persist across navigation, so you can walk several pages of a preview
and submit them as one pull request. The side panel lists everything pending
and lets you discard individual edits.

**Comment is the odd one out.** It changes nothing and stages nothing — it
files a note to the dashboard inbox, pinned to the element and, where the
page is annotated, to the source line. It is there for the person who has
noticed something but should not or cannot change it themselves.

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
npm run dev:dashboard    # dashboard (builds the widget first)
npm run build:widget     # the embeddable widget on its own

npm test                 # unit tests
npm run test:e2e         # Playwright, against the real build
npm run preview          # demo page
```

Some behaviour only holds across the real request pipeline — a guard, the
validation pipe, a resolver and the database, in that order. Those live in
`apps/api/test/*.sh` and run against a local API:

```bash
npm run dev:api                          # in one terminal
bash apps/api/test/feedback-public.sh    # the public endpoint and its gates
bash apps/api/test/feedback-inbox.sh     # triage, ownership, promotion
bash apps/api/test/editing-access.sh     # who may edit what
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

**The public widget** is the one endpoint an unauthenticated stranger can
reach, and it accepts an image, so it is worth stating what stands in front
of it:

- **Off by default, per site**, and the domain must be **verified**. Without
  that second check anyone could register your hostname and collect feedback
  meant for you. Turning it off takes effect on the next request.
- **Per-address and per-site rate limits.** The second is not redundant: a
  flood spread across many addresses defeats the first entirely.
- The **page URL must be on the site's own hostname**, so a comment cannot be
  filed against a real site while naming any URL at all.
- Screenshots are checked against **magic bytes**, never their declared type.
  Believing the label is how an upload endpoint becomes a way to host
  arbitrary content on someone else's origin. SVG is refused outright.
- Visitor addresses are stored as a **salted hash**. An unsalted hash of an
  IPv4 address is reversible by brute force in seconds.
- Every refusal gives the **same message**. A stranger cannot tell
  "unregistered" from "unverified" from "switched off", which would otherwise
  be free reconnaissance.
- It sends **no credentials**, which is what makes its open CORS policy safe
  rather than a hole — there is no ambient authority for a hostile page to
  borrow. The authenticated routes keep their origin allowlist.

Report anything you find privately rather than opening an issue.
