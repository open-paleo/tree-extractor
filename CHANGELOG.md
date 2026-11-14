# Changelog

## 0.5.3 (unreleased)

- A vertical cut by a clade's name printed across it is joined again, where the two ends at
  the gap are loose and the column is cut only once. One such cut had left half of a tree
  without a parent (Prieto-Marquez 2012: 37 of 70 tips named, now 68).
- A plain solid dot on a junction counts as a node disc down to three line widths across,
  so the branches run on through it; such dots had been taken for letters, cutting the tree
  at every named node (Manitkoon 2023: 55 of 74 tips named, now 71).
- `npm run bench:causes` tallies lost tip names by the step that lost them, and a second
  random sample of census figures with gold trees joins the holdout.

## 0.5.2 (2026-11-13)

- Qualifiers of open nomenclature stay on a name as printed: "cf.", "aff.", "indet." and
  "sp. indet.", as "sp." already did.
- In the viewer, a node named from a shaded box shows its support value in a field of its own.
- Poole 2022 figure 3 joins the holdout with a gold tree and its nine clade names.
- A list of known clades mends the spelling of a clade's name read at a node, on a shaded box
  or at a tip that is a collapsed clade, keeping the capitals it was printed in. The list
  ships as `names/known-clades.txt` (package export `./known-clades.txt`) and is supplied to
  the viewer as `knownClades`, to the element as `known-clades-url` or the `knownClades`
  property, and to the command line with `--known-clades`. It is kept apart from the known
  taxa so that a clade never competes with a genus for a tip.

## 0.5.1 (2026-11-13)

- Name matching makes alike the letters the OCR engine takes for one another: a capital O
  read as Q, a capital I read as a small L, and the digits 0 and 1. "Quranosaurus", which the
  engine reads for an italic Ouranosaurus, finds its name.

## 0.5.0 (2026-11-13)

- A clade's name printed on the colored box or band that shades it is read and attached to
  the clade's node. The region is the fill the name sits on, or a frame drawn around it; the
  clade is the node whose tips are exactly those in the region, and a region that matches no
  single clade is left alone. The name stands for the node in the Newick; a support value
  read at the same node stays in the document.

## 0.4.3 (2026-11-12)

- A node with no label to its left takes one that begins just right of its junction, level
  with it: a clade name or support value drawn over the gap between the node's branches.
- A tip is named as printed. The known taxa now include the original combination of every
  species since moved to another genus, so a figure's "Zalmoxes shqiperorum" matches as it
  stands; and a species read correctly is kept when the known taxa hold only its genus,
  where it was being cut to the genus. The paper's own name list still decides.
- An indeterminate species, "sp." with or without a number, stays on a genus the known taxa
  supplied: "Rhabdodon sp. 1" was being named "Rhabdodon".
- The quality checks remark on a known-taxa name only when it changed what was read, and note
  a species kept as read; a name merely confirmed no longer raises a warning per tip.

## 0.4.2 (2026-11-11)

- A clade name printed at a node is kept as a name; it was read as a support value, leaving
  only the letters that pass for digits ("Dryomorpha" became "00").

## 0.4.1 (2026-11-10)

- The top box holds only what starts an extraction: the image chooser and the extract button
  side by side, the OCR choice and the region tools under them, and the names field beside
  them behind a thin rule.
- The bar above the figure holds editing only: the pointer tools (Select, Add tip, Add node,
  Move) as one joined control, and Undo, Redo and Delete. View controls sit on the figure.
- The layer toggles are a plain row under the figure; moving the selection from the keyboard
  appears beside the lists when something is selected.

## 0.4.0 (2026-11-09)

- Viewer layout: the controls are a bar across the top, with the figure and the results side
  by side below it; one column under 760 px of the viewer's own width.
- No text smaller than 14 px, and a `--te-font-size` custom property for the base size.
- The layer toggles wrap with a gap between rows.

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
