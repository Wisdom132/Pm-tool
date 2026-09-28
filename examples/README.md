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
