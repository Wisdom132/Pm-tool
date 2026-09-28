# Angular example

Angular's annotation runs through **webpack**, not Vite, so this example is
source files plus the config excerpt rather than a runnable app.

The other three examples are built in CI by `tests/annotation-build.test.js`.
This one is not: running it needs a full Angular workspace and
`@angular-builders/custom-webpack`, which together are larger than the rest
of this repository's dependencies combined. Its annotator is unit tested
(`tests/angular-annotator.test.js`), so the logic is covered — but the
**wiring is not**, and that is precisely the gap that hid a broken Vue
plugin until `examples/vue` was built for real. Treat Angular as the least
verified of the four.

## Wiring

Install `@angular-builders/custom-webpack`, then merge `angular.json.excerpt`
into your `angular.json`.

Both forms are annotated:

- `templateUrl` files — through `template-loader.js`
- inline `template:` backtick literals — through `template-annotator.js`

## Running

```bash
INLINE_EDIT=1 ng build
```
