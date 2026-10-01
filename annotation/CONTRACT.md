# The annotation contract

What the build plugins emit and the editor reads. This is a **public wire
format**, not an implementation detail — once a page carrying these
attributes is deployed, it is out of our hands until that site redeploys.

## The governing fact

The two halves update at completely different speeds:

| | How it updates | Realistic lag |
|---|---|---|
| **Extension** | Chrome Web Store, silently | days |
| **This package** | `npm update` *and* a redeploy | months, or never |

So **the extension is almost always newer than the plugin** on any given
page. Every rule below follows from that.

## The rules

1. **Attributes may only be added.** Never renamed, never removed, never
   given a new meaning. A rename breaks every already-deployed site until
   each one redeploys, which is not something we can make happen.

2. **The extension feature-detects; it never version-gates.** Check whether
   an attribute is present, not what `data-edit-version` says. The version
   exists to *explain* a limitation, never to decide behaviour.

3. **Absence is a supported state.** Every attribute is optional. A page with
   none of them is an ordinary page, and the editor falls back to Locate —
   searching the repository for the text. That path must keep working.

4. **A new feature degrades, it does not fail.** `data-edit-i18n-key` was
   added this way: pages built before it simply cannot edit translated copy,
   and everything else still works.

## On `<html>`

Describes the build as a whole. All optional — a local build with no CI
variables has only `data-edit-version`.

| Attribute | Example | Meaning |
|---|---|---|
| `data-edit-repo` | `acme/site` | `owner/name`. Display only — the server derives the real repository from the site registry, never from this. |
| `data-edit-branch` | `main` | The branch this build came from. |
| `data-edit-commit` | `94be8d1…` | **The commit the build came from.** Edits branch from this, so the diff contains only the editor's changes. |
| `data-edit-version` | `1.2.0` | Which version of this package stamped the page. Diagnostics only. |

## On elements

| Attribute | Example | Meaning |
|---|---|---|
| `data-edit-file` | `src/Hero.vue` | **Provenance.** Repository-relative path of the file that produced this element. Wide: stamped on anything traceable, including elements that cannot be edited. |
| `data-edit-line` | `14` | 1-based line within that file. |
| `data-edit-col` | `4` | Column of the opening tag. 0-based for React, Svelte, Angular; **1-based for Vue**, matching each framework's own parser. Nothing compares a column across frameworks. |
| `data-editable` | `true` | **The editing contract.** The codemod can rewrite this element's text. Narrow on purpose: offering an edit that fails at pull-request time is worse than not offering it. |
| `data-edit-framework` | `vue` | Which codemod should handle it. |
| `data-edit-i18n-key` | `hero.title` | The element renders a translation call. The edit is redirected to the locale file, not the component. |

### `data-edit-file` is not `data-editable`

They mean different things and were conflated once, at real cost:

- **`data-edit-file`** — *this came from here.* An image is rarely editable
  but you still need to know which component drew it, so Inspect and Comment
  can name a file.
- **`data-editable`** — *the codemod can rewrite this.* Only elements whose
  text can be replaced without destroying markup.

Every element with `data-editable` has `data-edit-file`. The reverse is not
true, and must not be assumed.

## Versioning

`data-edit-version` is this package's own version, read from its manifest.

Features and the version that introduced them:

| Feature | Since |
|---|---|
| `data-edit-file` / `line` / `col`, `data-editable` | 1.0.0 |
| `data-edit-framework` | 1.0.0 |
| `data-edit-i18n-key` — React only | 1.0.0 |
| `data-edit-i18n-key` — Vue, Svelte, Angular | 1.0.0 |
| `data-edit-version` | 1.0.0 |
| Provenance on unannotatable elements (`data-edit-file` without `data-editable`) | 1.0.0 |

Everything currently reads 1.0.0 because nothing has been published yet.
**The first publish is when this table starts earning its keep** — from then
on, a row is added whenever an attribute or a meaning is introduced, and the
extension uses it only to explain what an older build cannot do.

## Changing this file

Adding a row is routine. Changing or removing one is not: it breaks sites
that are already deployed and cannot be made to redeploy. If a meaning has to
change, **add a new attribute and leave the old one alone**.

`tests/annotation-parity.test.js` asserts this contract across all four
plugins, including the attribute names themselves — so a rename fails the
suite rather than shipping.
