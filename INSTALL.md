# Installing Caliper

Caliper has two halves: a plugin that runs in **your** build, and a service
that turns an edit into a pull request.

This guide covers the half you install — the plugin and the browser
extension. The service is run for you; **[self-hosting it is not available
yet](#self-hosting--coming-soon)**.

---

## Add Caliper to your app

### 1. Install the annotation plugin

```bash
npm install --save-dev @usecaliper/annotation
```

A dev dependency, deliberately. It writes `data-edit-*` attributes into your
markup at build time so an edit in the browser can be traced back to the file
and line that produced it. Nothing about it belongs in a production bundle.

### 2. Wire it into your build

Pick your framework. The file and the ordering both matter.

<details open>
<summary><strong>Nuxt</strong> — <code>nuxt.config.ts</code></summary>

```ts
export default defineNuxtConfig({
  modules: ['@usecaliper/annotation/nuxt'],
});
```

A module rather than a Vite plugin: Nuxt renders through Nitro, and that is
what puts the build metadata on `<html>`.
</details>

<details>
<summary><strong>Vue + Vite</strong> — <code>vite.config.js</code></summary>

```js
import inlineEdit from '@usecaliper/annotation/vue';

export default defineConfig({
  plugins: [inlineEdit(), vue()],
});
```

**Before `vue()`.** The plugin needs the raw `.vue` file, not the compiled
render function.
</details>

<details>
<summary><strong>React + Vite</strong> — <code>vite.config.js</code></summary>

```js
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react({
      babel: { plugins: ['@usecaliper/annotation/react'] },
    }),
  ],
});
```
</details>

<details>
<summary><strong>Next.js</strong> — <code>.babelrc</code></summary>

```json
{
  "presets": ["next/babel"],
  "plugins": ["@usecaliper/annotation/react"]
}
```
</details>

<details>
<summary><strong>SvelteKit</strong> — <code>vite.config.js</code></summary>

```js
import inlineEdit from '@usecaliper/annotation/svelte';

export default defineConfig({
  plugins: [inlineEdit(), sveltekit()],
});
```

**Before `sveltekit()`.** The compiler turns components into JavaScript, and
the markup has to be read first.
</details>

<details>
<summary><strong>Angular</strong> — <code>angular.json</code></summary>

```json
"customWebpackConfig": {
  "path": "./node_modules/@usecaliper/annotation/angular/webpack.config.js",
  "mergeStrategies": { "module.rules": "prepend" }
}
```

Goes under `architect.build.options`, and needs
`@angular-builders/custom-webpack`.
</details>

### 3. Check it worked

Run your dev server and look at `<html>` in devtools. You should see:

```html
<html data-edit-repo="owner/repo" data-edit-branch="main" data-edit-commit="…" data-edit-version="…">
```

and `data-edit-file` on elements throughout the page. If `<html>` has those
attributes but no element does, the plugin is loaded but running in the wrong
order — check the "before" notes above.

### 4. Install the extension

Caliper is not on the Chrome Web Store yet, so it loads unpacked:

```bash
git clone <this repo>
cd Inline-editor
npm install
npm run build:ext
```

Then `chrome://extensions` → **Developer mode** on → **Load unpacked** →
select `inline-edit-tool/extension/dist`.

Open the extension popup and set the **service URL** — the Caliper instance
your team connects to. If you do not have one yet, see
[self-hosting](#self-hosting--coming-soon) below.

Anything other than `localhost` **must** be `https://`. The extension sends a
bearer token to that origin and will refuse to send it in the clear.

---

## When annotation turns itself on

This is the part worth reading carefully, because the failure mode is
publishing your source layout to the public internet.

Annotations name every source file that rendered the page. On a preview
deploy that is the point; in production it is a directory listing of your
codebase that anyone can read. So the plugin decides for itself, in this
order:

1. **`INLINE_EDIT` wins, either way.** `INLINE_EDIT=0` turns annotation off
   even on a preview — the only way to opt a sensitive branch out.
   `INLINE_EDIT=1` turns it on anywhere.
2. **A host that calls the build production is obeyed**, and nothing below
   can override that.
3. **Otherwise preview deploys and dev builds are annotated**, and everything
   else is not.

Auto-detected hosts:

| Host | Read from |
|---|---|
| Vercel | `VERCEL_ENV` |
| Netlify | `CONTEXT` |
| Cloudflare Pages | `CF_PAGES_BRANCH` vs `CF_PAGES_PRODUCTION_BRANCH` |
| Render | `IS_PULL_REQUEST` |

**On these hosts you do not need to set anything.** Preview deploys are
annotated and production is not, automatically.

Anywhere else — a self-hosted build, AWS Amplify, a GitHub Actions job —
Caliper cannot tell what the build is for, so it stays **off** and you set
`INLINE_EDIT=1` on the previews you want editable. Off-by-default is the only
safe answer when the host does not say.

> `npm run check:no-annotations` fails a build that shipped annotations to
> production. Worth putting in CI.

---

## Self-hosting — coming soon

Running your own Caliper service is not supported yet.

It works — the API, the dashboard and the GitHub App integration all run
locally today — but it is not something we are ready to have other people
depend on. Self-hosting means a Postgres schema, a credential-encryption key
and a GitHub App whose installation token can open pull requests on your
repositories. Publishing instructions for that before the upgrade path and
the key-rotation story are settled would be handing people a system we cannot
yet promise to keep working.

When it lands, this section will cover:

- Postgres and the migration path
- The GitHub App: which permissions, and why an installation token rather
  than OAuth
- The five required environment values, and the two commands that prove they
  work before a browser is involved
- Hosting the dashboard and the public feedback widget

**In the meantime**, talk to us about an instance for your team.

> Working on Caliper itself? The repository's `README.md` has what you need to
> run the stack locally. Those instructions are for developing Caliper, not
> for running it in production.

---

## Troubleshooting

**Nothing is clickable / the toolbar does nothing.**
The page has no annotations. Check `<html>` for `data-edit-repo` (step 3
above). The most common cause is a production build — see
[when annotation turns itself on](#when-annotation-turns-itself-on).

**I changed the plugin config and nothing changed.**
Build caches hold the old output. For Nuxt:

```bash
rm -rf .nuxt node_modules/.vite
```

**"No build annotation" when rearranging.**
Rearrange needs `data-edit-file` on the element itself, not just on an
ancestor. Some elements are provenance-only.

**The design tool's alignment rows are greyed out.**
Deliberate — `justify-center` does nothing to an element that is not a flex
or grid container, and writing it anyway would put a dead class in your pull
request. Step the **Display** row to `flex` first. Hovering a dimmed row says
which requirement is unmet.

**The design panel says the page does not use utility classes.**
Also deliberate. Caliper steps existing utility classes (`p-4` → `p-5`) so
changes arrive as the diff your team would have written. On a codebase that
does not use them there is nothing honest to step.

---

## What next

`README.md` explains how the pieces fit together and why they are built that
way.
