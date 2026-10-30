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
`--set=key=value` overrides a pipeline parameter for the run (`--set=shortConnectors=true`),
which is how a change is bisected against the cases.
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

## Held-out cases

`bench/holdout/cases/` holds figures the pipeline was never tuned on, with a name list and,
for some, a gold tree (`gold.nex` plus `gold_note` in `case.json`). `npm run bench:holdout`
runs them cold: a case without gold prints how many tips the tree has, how many matched a
listed name, and the quality-check findings; a case with gold is scored like a benchmark case
but never expected identical. Three such cases are time-calibrated figures that are not openly
licensed (Hu 2009, Wilson 2016, Bellardini 2025); their images stay out of the repository,
referenced from `bench/images/census/`, while the seven openly licensed ones of the same batch
moved to `bench/cases/` with their images. Once a case has been checked and is stable, it
moves to `bench/cases/`.

## Batch run over a corpus

`npm run bench:batch -- --manifest=<file.json> --root=<dir>` runs every figure of a manifest
cold (no gold, nothing scored) and prints a summary by layout class: figures that yielded a
tree, crashes, mean tips, the share of listed names matched where a list exists, seconds per
figure, and the most frequent quality checks. The manifest is a JSON array with one row per
figure: `id`, `image`, optional `names` and `region`, `layout`, `flags`, and `is_tree` (false
rows are skipped without `--all`); paths are relative to `--root` or the manifest's directory.
Per-figure results go to `<out>/results.jsonl` and `<out>/<id>/` (document and Newick, and an
overlay with `--overlay`). The census of the Open Paleo corpus (`bench/images/census/`, not
committed) is the set this was written for: `--manifest=bench/images/census/manifest.json
--root=bench`.
