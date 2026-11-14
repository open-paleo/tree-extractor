# Known taxon names

`known-taxa.txt` lists every genus, species, synonym and original combination of a species
since moved to another genus in the Open Paleo data build, one name per line. A figure is
read as printed, so a name stays in the combination the figure uses. The extractor uses it as a second tier of name matching: a label that the
paper's own name list does not explain is offered to this list at a stricter threshold, and
a match from it is flagged in the quality checks as coming from outside the paper's taxa.

`known-clades.txt` lists the clades above the genera. It mends the spelling of a clade's
name read at a node, on a shaded box or at a tip that is a collapsed clade, and is kept
apart so that a clade never competes with a genus for a tip.

Snapshot of open-paleo/data version 2026.11, built 2026-11-13T16:12:40.546Z,
3370 names. Regenerate with `npm run names:import -- <path to open-paleo.json>`.

The data build is CC BY 4.0, attributed to the Open Paleo contributors.
