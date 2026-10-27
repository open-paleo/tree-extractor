# Design

Decisions settled on 2026-10-26 before any code was written, and how the pipeline turned out.

## Decisions

**TypeScript end to end.** The vision work this needs is thresholding, run-length scanning,
connected components and a little morphology, all easy over a `Uint8Array`. Keeping one language
means the browser viewer and the Node command line share one implementation and one benchmark,
and the tool can be hosted as a static page with no install.

**Viewer first, batch as the same pipeline run headless.** A command-line result cannot be
corrected, only re-run, and developing a vision pipeline is itself visual work. The extraction
document (JSON) is the single representation the pipeline writes, the viewer edits and the
exporters read; it records provenance (`traced` or `manual`) per element.

**No learned node detector in the first release.** Treemble's open model (MIT) finds internal
nodes at 75% recall, cannot be retrained (training data is not public), and tells nothing about
how many children a node has. Line tracing gives node position, child count and topology in one
step. The tracer is the only node source for now; a learned proposal source can be added later
for degraded scans or slanted trees.

**Tesseract.js for OCR, per label, against a closed list.** Each label is cropped once its
position is known, upscaled three times, read as a single line with line art painted out, and
fuzzy-matched (Levenshtein) against the supplied names. On the benchmark figure raw exact reads
were about 70%; after matching, 100%.

**Permissive dependencies only.** Tesseract.js and sharp are Apache-2.0. The Newick and Nexus
writers are our own, so the GPL-licensed ete3 and similar are not needed.

## Pipeline

1. **Masks.** Text ink is luminance below 140. Line ink is luminance below 180 with low chroma
   (so colored clade boxes and the red border drop out), extended by hysteresis into faint
   pixels (below 230) that touch it, except near glyphs, then closed by one pixel. This mends thin
   lines that JPEG compression breaks.
2. **Rough text pass.** Long straight runs are stripped from the text ink; the remaining connected
   components are glyphs; glyphs cluster into rows by a robust center line. This yields the glyph
   height, which scales every later threshold, and the glyph pixels, which are removed from the
   line ink unless they lie on a long straight run (a branch that a label touches).
3. **Segments.** Horizontals are the connected components of pixels in long horizontal runs,
   verticals likewise for columns, so a thick branch cannot read as a short connector and a
   connector cannot be swallowed by the branch it crosses. Columns where the dark ink is glyph-high
   split a horizontal, label rows clip it, verticals inside label rows are dropped, and collinear
   pieces are rejoined across the gap a label's white background box cuts (up to six glyph
   heights for horizontals, far less for verticals, which stack).
4. **Trace.** Every vertical is a candidate node; every horizontal whose left end touches it is a
   child and the one whose right end touches it is its parent. A horizontal running straight
   through a vertical is split there (the middle child of an odd polytomy). Ends that fall short
   attach loosely, but only in the direction the branch points. Verticals with no children are
   discarded and attachment is repeated until stable. Nodes with no parent are joined to the
   nearest node on their left whose span overlaps theirs, which in a planar drawing can only be
   the parent. Unary nodes collapse. The largest connected tree is the result; the rest is
   reported.
5. **Labels.** Text is detected again with the traced line art (and any range-bar stub beyond it)
   painted out, then tip rows are assigned to the nearest branch end on their left and remaining
   rows to the nearest junction on their right. Short unlabelled tips are dropped as debris.
6. **OCR and matching**, then **QC**: unlabelled tips, unmatched names, duplicates, disconnected
   pieces, and every rejected vertical with its reason are recorded in the document.

## Known gaps

- Support values at nodes are read for only about a third of nodes on the benchmark figure; the
  labels that sit on a branch or a vertical are partly eaten by line-art removal. Topology and tip
  names are unaffected.
- Thresholds assume figures roughly 1000 to 2500 pixels wide with glyphs 8 to 20 pixels tall.
  Smaller text needs upscaling first.
- A label whose first letter touches its branch with no gap can lose that letter to the OCR crop;
  name matching usually recovers it.
- Only one benchmark figure so far. More cases, especially cladograms with aligned tips, black
  clade boxes and slanted trees, will change the thresholds.
