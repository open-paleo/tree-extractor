# Changelog

## 0.3.2 (2026-11-09)

- The actual-size button's accessible name begins with its visible text, "1:1 (actual size)":
  the 0.3.1 wording put the text in parentheses, which newer axe reads as a different word.
  The browser test now runs the same axe version as the site.

## 0.3.1 (2026-11-09)

- The actual-size button's accessible name contains its visible text, "1:1" (WCAG 2.5.3); the
  browser test now runs the WCAG 2.1 level A rules, where that check lives.

## 0.3.0 (2026-11-09)

The viewer becomes a component a site can mount, and accuracy is measured on a random sample.

- `mountTreeExtractor(element, options)` mounts the viewer and returns a handle that reads the
  current tree and removes the viewer again; the standalone page is a wrapper over it. The
  same viewer is a custom element, `<tree-extractor>`, defined on request.
- No request to a third party: the worker, Tesseract.js, its core and its language data are
  named by the host, and the standalone page serves them from `node_modules`.
- Styles sit under one class and take colors, fonts and radius from custom properties;
  element ids are prefixed; the layout follows the width of its own element.
- Package exports for the pipeline, the viewer, its stylesheet and its worker, built with type
  declarations; `sharp` is an optional peer and `tesseract.js` is pinned.
- Accessibility: labeled controls, visible focus, lists that select on focus, moving the
  selection from the keyboard, checked with axe at WCAG 2.2 AA in light and dark.
- Twenty census figures drawn at random with gold trees, and five figures from other animal
  groups, join the holdout: 78 percent of tips named and 91 percent of splits on the random
  twenty.
- Orientation and marker detection see colored branches; repeated tip names are numbered;
  pale fills no longer flood into fragmented text.

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
