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
   line ink unless they lie on a long straight run (a branch that a label touches) or on a
   shorter horizontal run that joins one (a branch stub next to a thick vertical). When the first
   pass finds large letters, the strip is scaled to the glyph height and the pass repeated, since
   a stroke of a 35-pixel letter is longer than the default strip. A thin upright of about a
   letter's height is not a glyph (it may be a short connector), but a row with text on both
   sides of it takes it in, so a tall ascender does not cut a label in two.
3. **Segments.** Horizontals are the connected components of pixels in long horizontal runs,
   verticals likewise for columns, so a thick branch cannot read as a short connector and a
   connector cannot be swallowed by the branch it crosses. The shortest run that counts is twice
   the line thickness, which is measured on the mask as the median vertical run of ink, so a
   thick figure does not turn its verticals into stacks of short horizontals. Columns where the
   dark ink is glyph-high split a horizontal, label rows clip it, verticals inside label rows are
   dropped, and collinear pieces are rejoined across the gap a label's white background box cuts
   (up to six glyph heights for horizontals, far less for verticals, which stack).
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
6. **OCR and matching.** Each label is cropped from the image with the line art painted out and
   upscaled three times; letter-spaced text, recognized by the blank columns between letters, is
   condensed horizontally first. Reads are matched to the name list by edit distance, allowing
   the genus alone, the genus abbreviated to its initial, and a binomial read against a
   genus-only list; two names that share a generic ending such as *-saurus* are no closer than
   their stems. Tips whose read matched nothing are then paired with the names nobody claimed,
   by elimination, when one name stands clearly apart; such tips are flagged for checking.
7. **QC**: unlabelled tips, unmatched names, duplicates, disconnected pieces, tips named by
   elimination, and every rejected vertical with its reason are recorded in the document.

## Known gaps

- Support values at nodes are read for only about a third of nodes on the benchmark figure; the
  labels that sit on a branch or a vertical are partly eaten by line-art removal. Topology and tip
  names are unaffected.
- Text ink is taken at a strict threshold, and widened by hysteresis into fainter connected
  pixels only when the strict mask is fragmented (thin serif fonts) or the glyph height is 7 px
  or under, because the same widening merges bold letters and rows. A hairline font at a normal
  size can still lose a serif or half a letter, which the row clustering tolerates but the OCR
  may not.
- When two tips read the same (two species of one genus whose epithets were not read), the
  pairing by elimination is arbitrary between them; the quality check names both.
- A label whose first letter touches its branch with no gap can lose that letter to the OCR crop;
  name matching usually recovers it.
- Eight real figures are in the benchmark: Dieudonné 2026, Longrich 2010, Maidment 2008 panel A
  as a region of a page scan, and Madzia 2019 from subscription journals (images supplied
  locally), and Hattori 2026, Ke 2023, Raven 2018 and Yang 2025 under CC BY (images committed
  with attribution). Their gold trees were produced by the tool and checked against the image
  node by node at 3x zoom; Dieudonné's additionally by a vision model.
- Debris tips remain the commonest flaw on real figures: a short unlabelled piece, or one that
  claimed a support value as its label, hanging from a real node. They are flagged by the quality
  checks and are one click to delete in the viewer, but they stop a case from being identical.
- On the synthetic benchmark, clean, serif, dense and most touching-label figures come out
  identical. Time-scaled phylograms still lose a few tips where a boxed support label covers
  most of a short branch, or where a range bar extends left past the branch's start; both are
  commoner in the generator than in published figures, but real.
