# Known taxon names

`known-taxa.txt` lists every genus, species and synonym in the Open Paleo data build, one
name per line. The extractor uses it as a second tier of name matching: a label that the
paper's own name list does not explain is offered to this list at a stricter threshold, and
a match from it is flagged in the quality checks as coming from outside the paper's taxa.

Snapshot of open-paleo/data version 2026.10, built 2026-10-25T00:53:11.657Z,
3301 names. Regenerate with `npm run names:import -- <path to open-paleo.json>`.

The data build is CC BY 4.0, attributed to the Open Paleo contributors.
