# Changelog

## 0.2.0 (2026-11-06)

Trees drawn in more ways, a viewer that can finish a tree by hand, and a measured census.

- Trees drawn on their side are turned a quarter and traced like the rest; a column of level
  labels beyond the branch ends vetoes a turn, and sideways text breaks a tie.
- Slanted trees are traced from the skeleton of their line art, with fans collapsed, leaders
  dropped and paired tips read.
- Time-calibrated figures: stage charts are dropped before tracing, stage lines crossed by the
  tree are removed, node discs and rings are bridged by a painted cross, range bars in any tint
  carry a tip to its label, and a time axis with readable numbers gives ages and branch lengths.
- A phylogram with no readable axis gets its branch lengths in pixels; a cladogram gets none.
- Labels set at a slant are read in a level frame; labels may stand above their branch; a tip
  of the main tree takes a row before a loose one does; range bars stay out of text rows.
- A figure drawn in gray has its ink thresholds raised to sit above the gray.
- Viewer: move a tip or node by dragging it onto the node it should hang from, restore a loose
  piece the same way, select an element from the quality check that names it, and undo and
  redo every edit back to the extraction.
- Command line: a folder of figures is read image by image, each with the name list beside it.
- Benchmark: twenty-five published figures with gold trees, eleven identical, and fifteen
  synthetic; a held-out set run cold; a batch runner for a corpus manifest; a strict mode in CI
  that fails when a case expected identical is not; a headless-browser test of the viewer.
- Census: 178 tree figures from the Open Paleo corpus run cold with no crash, 168 giving a tree
  of three tips or more, 86 percent of tips named where a taxon list exists.

## 0.1.0 (2026-10-27)

First working version: rectangular trees with the root on the left traced to Newick and
Nexus, labels read with Tesseract.js and matched against a taxon list and the known taxa of
the data set, a browser viewer with zoom, region selection, and adding and deleting of tips
and nodes, a figure profile, a time axis fit, decoration removal, and a benchmark of eight
published figures and fifteen synthetic ones.
