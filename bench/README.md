# Benchmark cases

Each directory under `cases/` holds:

- `case.json` with relative paths to the image, the gold tree and the name list
- `gold.nex`, a Nexus file whose first tree is the checked answer
- `names.txt`, one taxon name per line, usually the taxa of the paper's matrix

Figure images are copyrighted by their publishers and are not committed. Put them in
`bench/images/` under the filename named in `case.json`, then run `npm run bench`.
Outputs (document, Newick and an overlay PNG) go to `bench/out/<case>/`.

## Synthetic cases

`npm run bench:generate` renders random trees in five figure styles (clean, paper, time-scaled,
dense, touching) under `bench/generated/`, three per style by default, with gold trees and name
lists. Generation is deterministic from `--seed` (default 1); `--per-style N` changes the count.
The generated directory is not committed; `npm run bench` picks the cases up when present, and
`npm run bench -- --only=paper` restricts a run to matching case names. The styles are in
`bench/synthetic/generate.ts`; a new style is one more preset there.
