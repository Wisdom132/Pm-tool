# Editing

The codemods: given a file's contents and a list of edits, return new
contents. They are the oldest and most heavily tested code in the project —
171 tests across eight files — and they moved here unchanged from
`overlay/pr-service/lib/`, which has since been deleted. `git log --follow`
on any file here reaches its full history.

## Why these are `.js`, not `.ts`

They are plain ESM JavaScript with JSDoc types, and they stay that way:

- **The tests point straight at them.** `tests/codemod*.js`, `locale`,
  `patcher` and `svelte-annotator` import these modules directly under
  Vitest, with no build step. Converting them to TypeScript would mean the
  test suite exercises compiled output rather than the source, or that the
  suite needs its own TS pipeline — for no gain in a file that never sees a
  Nest decorator.
- **Nothing here needs the framework.** A codemod takes strings and returns
  strings. It has no injected dependency, no request context and no database,
  so being a Nest provider would add a container for nothing.
- **Rewriting 1,442 lines of parser-adjacent code is how subtle bugs get
  in.** The Vue plugin's 27-character offset bug and the JSX mixed-content
  refusal were both found the hard way; a mechanical conversion risks
  reintroducing that class of thing with tests that still pass.

`tsconfig.json` therefore sets `allowJs: true` and `checkJs: false`: they are
transpiled into the Nest build, not type-checked by it.

## Node 22.12 or newer

`@babel/parser` 8 is ESM-only. The Nest build is CommonJS, so importing it
relies on Node's `require(esm)` support, which landed in 22.12. On an older
runtime the build succeeds and then fails at the first JSX edit — which is
why `package.json` declares `engines.node >= 22.12` rather than leaving it to
be discovered in production.

Verified by requiring `dist/editing/codemod/index.js` from CommonJS and
applying one edit per grammar (JSX, Vue SFC, HTML).

## Layout

| File | What it does |
|---|---|
| `codemod/index.js` | Routes a file to the right grammar by extension; runs structural edits in their own pass |
| `codemod/jsx.js` | React/JSX, via `@babel/parser` + `magic-string` |
| `codemod/vue.js` | Vue SFCs, via `@vue/compiler-sfc` and `@vue/compiler-dom` |
| `codemod/html.js` | HTML, Svelte and Angular templates, via a depth-aware scanner |
| `codemod/text.js` | Plain-text replacement, the fallback |
| `codemod/locale.js` | i18n JSON, keyed rather than positioned |
| `codemod/locate.js` | Ranks candidate matches when a line has moved |
| `codemod/structure.js` | Move, duplicate and remove whole elements |
| `codemod/element-range.js` | Finds an element's byte range in markup |
| `patcher.js` | Builds commit messages, pull request and issue bodies |
| `log.js` | One JSON object per line. Kept so the codemods stay framework-free |
