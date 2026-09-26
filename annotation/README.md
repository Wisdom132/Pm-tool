# @quartalyst/inline-edit-annotation

Build-time plugins that stamp source locations onto the DOM, so rendered text
can be traced back to the file it came from.

Part of the [Inline Edit Tool](../README.md), but useful on its own to anyone
who wants `data-edit-file` / `data-edit-line` on their markup.

```bash
npm install --save-dev @quartalyst/inline-edit-annotation
```

## What it emits

On qualifying text-bearing elements:

```html
<h1 data-edit-file="src/components/Hero.tsx"
    data-edit-line="12"
    data-edit-col="4"
    data-editable="true"
    data-edit-framework="react">
  Build things that matter
</h1>
```

On `<html>`, describing the build itself:

```html
<html data-edit-branch="feature/pricing"
      data-edit-commit="9f1c2ab…"
      data-edit-repo="acme/site">
```

Elements whose text comes from a translation function get the key instead, so
the copy can be traced to a locale file:

```html
<p data-edit-i18n-key="home.cta.subtitle">…</p>
```

## When it runs

Inert unless `INLINE_EDIT` is truthy, or the bundler reports a dev build.

```bash
INLINE_EDIT=1 npm run build      # preview deployment
npm run build                    # production: no annotations
```

Annotations expose your source layout. **Never ship them to production.**

## Setup

### React / Next.js

```json
{ "plugins": ["@quartalyst/inline-edit-annotation/react"] }
```

### Vue / Nuxt

```js
import inlineEdit from '@quartalyst/inline-edit-annotation/vue';

export default { plugins: [vue(), inlineEdit()] };
```

### Angular

Requires `@angular-builders/custom-webpack`. In `angular.json`:

```json
{
  "customWebpackConfig": {
    "path": "./node_modules/@quartalyst/inline-edit-annotation/angular/webpack.config.js",
    "mergeStrategies": { "module.rules": "prepend" }
  }
}
```

## Build metadata

Branch, commit and repository are read from CI environment variables —
Vercel, Netlify, GitHub Actions, Amplify, Cloudflare Pages and Render are
detected automatically.

Git is only a last resort: build hosts check out a **detached HEAD**, where
`git rev-parse --abbrev-ref HEAD` returns the literal string `"HEAD"`, and
some build images ship no `.git` at all.

Override with `INLINE_EDIT_BRANCH`, `INLINE_EDIT_COMMIT`, `INLINE_EDIT_REPO`.

## What gets annotated

Text-bearing HTML elements — `p`, `h1`–`h6`, `span`, `a`, `button`, `label`,
`li`, `td`, `th`, `strong`, `em`, `small`, `b`, `i` — that contain literal
text rather than an interpolation.

Deliberately skipped:

- Elements whose content is an expression (`{title}`), because there is no
  literal in the source to change
- Elements mixing literal text with markup, because rewriting the whole
  content would destroy the markup
- Components (`<Hero>`), as opposed to native tags
- A translation call mixed with literal text, because which part was edited
  would be ambiguous
