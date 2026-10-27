# Benchmark cases

Each directory under `cases/` holds:

- `case.json` with relative paths to the image, the gold tree and the name list
- `gold.nex`, a Nexus file whose first tree is the checked answer
- `names.txt`, one taxon name per line, usually the taxa of the paper's matrix

Images come in two kinds:

- **Committed** (`figure.png` inside the case directory): only figures published under a license
  that allows redistribution and adaptation, in practice CC BY. The case's `case.json` must then
  carry `"license"` (for example `"CC BY 4.0"`) and `"attribution"` (authors, year, title,
  journal, DOI, figure number, license URL, and any change such as cropping), and the same text
  goes in the case's `attribution.txt`. The runner skips a committed image without them.
- **Local only** (`../../images/<name>` from `bench/images/`, which is gitignored): figures from
  subscription journals. Their gold trees and name lists are ours and are committed; the image
  has to be supplied by hand, and the runner skips the case when it is missing.

Run `npm run bench`; outputs (document, Newick and an overlay PNG) go to `bench/out/<case>/`.
`npm run bench:strict` (what CI runs) fails when a case listed in `expectations.json` is no
longer `identical`. When a change makes a new case identical, add it to that list; removing one
needs a reason in the pull request.

## Synthetic cases

`npm run bench:generate` renders random trees in five figure styles (clean, paper, time-scaled,
dense, touching) under `bench/generated/`, three per style by default, with gold trees and name
lists. Generation is deterministic from `--seed` (default 1) for a given machine, but SVG text
rendering depends on the fonts installed, so the generated images are committed and regenerated
only deliberately. `npm run bench -- --only=paper` restricts a run to matching case names. The
styles are in `bench/synthetic/generate.ts`; a new style is one more preset there.
