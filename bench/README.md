# Benchmark cases

Each directory under `cases/` holds:

- `case.json` with relative paths to the image, the gold tree and the name list
- `gold.nex`, a Nexus file whose first tree is the checked answer
- `names.txt`, one taxon name per line, usually the taxa of the paper's matrix

Figure images are copyrighted by their publishers and are not committed. Put them in
`bench/images/` under the filename named in `case.json`, then run `npm run bench`.
Outputs (document, Newick and an overlay PNG) go to `bench/out/<case>/`.
