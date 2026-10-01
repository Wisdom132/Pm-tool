# Examples

One minimal app per framework, each rendering the same component, each wired
to its annotation plugin the way a real project would be.

They exist to be **built**, not just read. `tests/annotation-build.test.js`
runs the actual bundler over `react/`, `vue/` and `svelte/` using each
example's own `vite.config.js`, so the wiring documented here is the wiring
under test. Before that existed, every plugin was tested against fixture
strings only — and "the plugin loads but does nothing" passed. The first real
build found the Vue plugin inserting attributes into the middle of a template
expression, breaking the build outright.

```bash
npm run test:examples     # build all three and assert the annotations
npm run example:react     # dev server, annotations on
npm run example:vue
npm run example:svelte
```

Each page carries a bar naming the framework and the component file, because
all three render the same thing and are otherwise indistinguishable.

## The editor runs on them

`npm run build:ext` once, then start any example: the toolbar appears on the
page, exactly as the extension's own demo does. Alt-click any text to open
its source.

The difference from `inline-edit-tool/extension/preview.html` is that
`/api/file` here reads the **real file from disk**, not a canned fixture — so
you are looking at the component that actually rendered the page, and an edit
previews against it. Editing `banner.css` in the styles tab resizes the
heading on the page as you type.

`Cmd/Ctrl+Shift+E` toggles the toolbar. It opens on load by default; pass
`autoOpen: false` if you would rather summon it.

Served straight from `inline-edit-tool/extension/dist/`, so a rebuild is
picked up on the next reload with nothing to keep in sync. If the extension
has not been built, the page says so instead of failing quietly.

Two things the examples cannot do, because a web page is not an extension:
**responsive preview** (it resizes the browser window) and **opening a pull
request**. Both report that plainly rather than appearing to work. This is
dev-only — a production build of an example ships no editor.

## What each one shows

Every `Banner` component contains the same four paragraphs, chosen to cover
the cases that matter:

| In the component | Why it is there |
|---|---|
| `<h1>Ship it on Friday</h1>` | plain text — must be annotated |
| `<p class="lead">…</p>` | text with an existing attribute — must not lose it |
| `<p>{count} deploys, {label.length} chars</p>` | text mixed with expressions |
| `<p>Read our <a href="/guide">guide</a></p>` | a nested editable element |
| `const label = '<p>not markup</p>'` in the script | markup in a string — must never be annotated |

## The frameworks disagree, on purpose

Which elements get annotated differs, and the build test asserts each set
exactly:

| | Annotated | Not annotated |
|---|---|---|
| **React** | `h1`, `p.lead`, mixed `p`, link `p` | — |
| **Vue** | `h1`, `p.lead`, mixed `p`, link `p` | — |
| **Svelte** | `h1`, `p.lead`, the `a` | the mixed `p`, its container |

A plugin should annotate exactly what its codemod can then edit safely. The
JSX and Vue codemods work on an AST and can rewrite a single text node, so an
element mixing copy with `{expr}` is editable. Svelte routes to the HTML
codemod, which replaces an element's whole inner range — rewriting text
beside an expression would destroy the expression, so those elements are left
alone.

Annotating what cannot be committed would offer an edit that silently fails
at PR time, which is worse than not offering the edit.

## Trying it on your own app

The same two plugins work in any Vite project — no extension, no service, no
GitHub. From your app:

```bash
npm i -D file:/ABSOLUTE/PATH/TO/inline-edit-tool-repo/annotation
```

```js
// vite.config.js
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO = '/ABSOLUTE/PATH/TO/inline-edit-tool-repo';

const inlineEdit = require('@usecaliper/annotation/vue');
const inlineEditPreview = require(`${REPO}/annotation/preview/index.cjs`);

export default defineConfig({
  plugins: [
    inlineEdit(),   // must come before vue(): it needs the raw .vue file
    vue(),
    inlineEditPreview({
      extensionDist: `${REPO}/inline-edit-tool/extension/dist`,
    }),
  ],
});
```

Then `INLINE_EDIT=1 npm run dev`. Build the extension once first
(`npm run build:ext` in this repo) or the page will tell you it is missing.

`root` defaults to the directory the dev server runs in, which is what the
annotation plugins make their paths relative to — so a normal project needs
no path configuration beyond the two above.

Nuxt keeps its Vite config one level in:

```js
// nuxt.config.ts
export default defineNuxtConfig({
  vite: { plugins: [inlineEdit(), inlineEditPreview({ extensionDist })] },
});
```

This gives you the whole editor against your real files. What it cannot do is
open a pull request — for that you need the extension and the service, because
the commit goes through a GitHub App.

## Where the styles live

Deliberately different in each, because that is what the editor's Styles tab
has to cope with:

- **React** — `Banner.jsx` imports `banner.css`, so the tab opens that file.
- **Vue** — a `<style scoped>` block inside the component; the tab says so and
  points at the first tab. Scoped styles preview unscoped.
- **Svelte** — a `<style>` block, same treatment.

## Angular

`angular/` is source files and a config excerpt rather than a runnable app:
its annotation runs through webpack, and a real workspace plus
`@angular-builders/custom-webpack` is larger than everything else here
combined. See `angular/README.md` — it is the least verified of the four.

## The flag

Nothing is annotated unless `INLINE_EDIT=1` is set, or Vite is in dev mode.
Each example's `build` script sets it explicitly, because a preview deploy is
a production build. The build test asserts the opposite case too: without the
flag, the bundle contains no annotations at all, so an ordinary deploy cannot
leak source paths to anyone who views source.
