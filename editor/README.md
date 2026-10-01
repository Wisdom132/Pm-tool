# @usecaliper/editor

The Caliper editor, served into your dev server so the tool can be used
without installing the browser extension.

```bash
npm install --save-dev @usecaliper/editor
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: [
    ['@usecaliper/annotation/nuxt', { preview: true }],
  ],
});
```

That is all. `@usecaliper/annotation` finds this package on its own; there is
no path to configure.

## Why this is a separate package

Two reasons, and the second is the real one.

**Size.** The annotation plugins are 26 KB. This is around 230 KB packed.
Most people use the browser extension and would be downloading an editor they
never load.

**Version independence.** Caliper's wire contract says the extension
*feature-detects and never version-gates*, so a site built with one version of
the annotation plugin works with an editor released long before or after it.
Shipping both in one package would create exactly the lockstep that rule
exists to prevent — every plugin patch would drag an editor release behind it.

## What it contains

| File | Loaded |
|---|---|
| `content.js` | up front |
| `page.css` | up front |
| `code-editor.js` | only when the source editor is opened |

So the cost in practice is the ~250 KB of `content.js`, not the full bundle.

## Overriding it

Working on the extension itself and want your rebuild picked up:

```ts
['@usecaliper/annotation/nuxt', {
  preview: { extensionDist: '/path/to/extension/dist' },
}]
```

An explicit path always wins over this package.

## Dev only

The preview server never runs in a production build. The editor is a
development convenience; for real use, install the browser extension.

MIT
