# Claude Code Instructions

All code in this repository must follow [CONTRIBUTING.md](CONTRIBUTING.md). Read it before
writing or modifying any code. The rules that are easy to miss:

- American English everywhere
- every function name starts with a verb
- no anonymous object types; name every returned object type
- nested `function` declarations instead of arrow closures; classes for stateful readers
- loops instead of map/filter/reduce chains on anything that runs per pixel, segment or branch
- a blank line before every `return`
- Allman braces, four-space indent, `type` not `interface`, `Array<T>`, no abbreviated names

The benchmark (`npm run bench`) must still report `identical=true` after any change to `src/core`.
