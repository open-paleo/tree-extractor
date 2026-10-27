# Contributing

tree-extractor follows the code style of the other Open Paleo repositories (see
[open-paleo/data](https://github.com/open-paleo/data) `scripts/CONTRIBUTING.md`): TypeScript run
directly on Node 24, Allman braces, four-space indentation, double quotes, `type` over
`interface`, `Array<T>`, no abbreviated identifiers, multi-line JSDoc on everything exported.
ESLint enforces the formatting; `npm run lint:fix` applies it.

Rules specific to this repository, or easy to miss:

- **American English** in code, comments and documentation: gray, color, neighbor, center,
  license, normalize.
- **Every function name starts with a verb**, because a function does something: `createDarkMask`,
  `measureColumnHeights`, `findNearestVertical`, `computeMedian`, `getTipDisplayName`.
- **No anonymous object types.** A function that returns an object gets a named `type` for it,
  and fields of other types are never inline object literals. Returning an object literal that
  conforms to a declared type is fine.
- **Few arrow functions.** Inner helpers are nested `function` declarations. A function that
  would hold a bundle of inner reader closures (the Newick parser) is a class. Arrows remain only
  where an API takes a callback and the body is a single expression.
- **Be sparing with map, filter, reduce, some and friends.** Plain loops are preferred, and
  required on anything that runs per pixel, per segment or per branch. Callback-based operations
  are performance killers.
- **A blank line before every `return` statement** (enforced by ESLint).
- **Globals are declared with types** (a `Window` augmentation in `src/web/globals.d.ts`), never
  through `globalThis as { ... }` casts.

Before opening a pull request:

```sh
npm run typecheck
npm run lint
npm test
npm run spellcheck
npm run bench      # must still report identical=true for every case with an image present
```
