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

0. **Orientation.** A tree drawn with its root at the bottom or top is turned a quarter so
   that its root is on the left, and everything after this works in the turned frame (the
   document records the turns, and the viewer turns its copy of the image to match). The
   decision comes from where branches end: a branch ends free at a tip, with the label just
   past the end, so free ends of long horizontal runs with loose ink to their right say
   root-left, and free ends of long vertical runs with ink above or below say root-bottom or
   root-top. An end beside a long run of the other direction is a junction, not free. Runs are
   taken only from large pieces of line ink, so letter strokes never count whatever the glyph
   height was judged to be, and the ink past an end may be a range bar or a silhouette as well
   as text. A figure whose line art lies mostly outside straight runs is slanted and is left as
   drawn, as is one with too few labelled ends to decide (labels set as PDF text, say). On the
   benchmark and holdout images this puts all thirty-five rectangular figures root-left, the
   four vertical ones root-bottom and the four slanted ones undecided, in 0.1 to 0.9 seconds.
1. **Masks.** Text ink is luminance below 140. Line ink is luminance below 180 with low chroma
   (so colored clade boxes and the red border drop out), extended by hysteresis into faint
   pixels (below 230) that touch it, except near glyphs, then closed by one pixel. This mends thin
   lines that JPEG compression breaks. Strongly colored dark pixels (chroma over 100, so JPEG
   fringes along black lines stay out) are split by shape: thin strokes, which are branches
   drawn in color, join the line ink; fat shapes, which are range ovals and markers, are kept
   aside; the outline of a colored box, joined back together where branches cross it, is
   neither and is dropped.
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
   (up to six glyph heights for horizontals, far less for verticals, which stack), but only when
   there is ink in the gap: an empty gap between a node's parent branch and a grandchild's
   branch in a staircase layout is a real gap.
4. **Trace.** A horizontal or vertical along the image edge spanning the figure is a frame and
   is dropped first, or its left edge would root everything. Every vertical is a candidate node; every horizontal whose left end touches it is a
   child and the one whose right end touches it is its parent. A horizontal running straight
   through a vertical is split there (the middle child of an odd polytomy). Ends that fall short
   attach loosely, but only in the direction the branch points. Verticals with no children are
   discarded and attachment is repeated until stable. Nodes with no parent are joined to the
   nearest node on their left whose span overlaps theirs, which in a planar drawing can only be
   the parent. Unary nodes collapse. The largest connected tree is the result; the rest is
   reported.
5. **Labels.** Text is detected again with the traced line art (and any range-bar stub beyond it)
   painted out, then tip rows are assigned to the nearest branch end on their left and remaining
   rows to the nearest junction on their right. Before that, a tip whose branch runs into a
   solid shape (a collapsed-clade wedge) or a colored marker (a range oval) of marker size moves
   to the shape's far side, where its label is, and its label row may start as far back as the
   branch did. A text row's box leaves out solid blocks (a range bar touching a label), so the
   row neither clips the branch stub next to the bar nor sits over it. Short unlabelled tips are
   dropped as debris, and so are disconnected pieces that lie where decorations go: entirely
   right of the tips (clade brackets), or above or below the tree without labels (a time axis,
   a legend). The main tree is then chosen again as the piece with the most tips, and once
   more after labels are read, since a chart or a frame can outnumber the tree before its
   pieces are recognized as debris.
6. **OCR and matching.** Each label is cropped from the image with the line art painted out and
   upscaled so that its letters are about 45 pixels high (at most three times, never less than
   one, since Tesseract's time grows with the crop's area and large letters need no help); letter-spaced text, recognized by the figure's letter gap in the
   profile, is condensed horizontally first. Reads are matched to the name list by edit distance, allowing
   the genus alone, the genus abbreviated to its initial, and a binomial read against a
   genus-only list; two names that share a generic ending such as *-saurus* are no closer than
   their stems. A tip printed in capitals is a collapsed clade and keeps its printed name unless
   a list has it exactly. A read the paper's list does not explain is offered to the known taxa of the
   data set (`names/known-taxa.txt`), which accepts only an exact name or a close one clear of
   its runner-up, and flags the tip as matched from outside the paper's taxa. Tips whose read
   matched nothing are then paired with the paper's names nobody claimed, by elimination, when
   one name stands clearly apart; such tips are flagged for checking. Tesseract's own English
   dictionaries were switched off as an experiment and changed no read on the benchmark, so
   they are left as they are.
7. **Profile.** Figure-level properties are measured once and recorded in the document: layout
   family, tip alignment, support label style, clade marks, font (stroke, letter gap, slant,
   whether the text ink was widened, how far label crops are condensed), time-scale signs (tint,
   the axis found from its ticks, range bars, and after label reading the calibration fit
   through the numbers along the axis), separate blocks of line art and the number of bridged
   gaps. Label reading takes its condensing from the profile, and with a calibration nodes and
   tips get ages and the Newick carries branch lengths in the axis's units (`--no-lengths`
   leaves them out); any value can be fixed through `profileOverrides` (CLI `--profile`).
   `docs/profiles.md` has the plan for what else will read it. The benchmark checks the profile
   against each case's expected values and reports a profile column.
8. **QC**: unlabelled tips, unmatched names, duplicates, disconnected pieces, tips named by
   elimination, tips off the tip line and label rows at it without a tip (when the profile says
   the tips are aligned), and every rejected vertical with its reason are recorded in the
   document. On an aligned figure a label row without a tip is first searched for in the line
   ink, and a branch piece ending at the line gets its tip back before labels are read.

## Redrawing

`renderTreeSvg` (`src/core/render.ts`) draws the traced tree from the document alone: tips on
evenly spaced rows in the figure's order, each node centered on its children, labels in a plain
italic font with the matched name where there is one and the OCR read otherwise. When every
member of the tree has an age the depths follow the ages and an axis with round ticks is drawn;
otherwise each node sits one step left of its deepest child, so every tip ends on the tip line.
The CLI writes it beside the Newick, and the viewer shows it under the Newick and updates it
with every edit. It is the output for anyone who wants the figure back as a simple graphic, and
the quickest check on the trace.

## Performance

Measured on an Apple laptop, single thread, 2026-10-27. The pipeline without OCR takes 0.2 to
3 seconds on the benchmark figures (0.4 to 10 megapixels) and 12 seconds on a 40-megapixel
upscale of the largest, at about 30 bytes of memory per pixel (1.2 GB at 40 megapixels), which
is where a browser worker would start to run out somewhere past 70 megapixels. Time grows a
little faster than the pixel count: the long-run strip is rebuilt up to three times when the
glyphs are large, and connected components are labeled about six times per image across text
detection and the profile. Tree size barely matters: a 400-tip synthetic figure with 1100
segments traces in 15 milliseconds, and the quadratic loops over segments and rows are a few
percent of the whole. Dilation and erosion are separable sweeps for large radii and painted
pixel by pixel for sparse masks with small radii, whichever is cheaper.

OCR dominates every run with labels: 30 to 75 milliseconds per label, in proportion to the
crop's area, so crops are scaled towards 45-pixel letters rather than always three times.
Large-font figures read two to three times faster for it; small fonts are unchanged.

## Known gaps

- A turned tree's labels come out horizontal only when they were set at a right angle. Labels
  set at a slant (Averianov 2006 and Kobayashi 2003 at about 60 degrees, Pacheco 2019 at about
  70) are traced but not read: the row detector breaks a slanted label into short pieces and the
  OCR gets fragments. Measuring the slant and turning each label crop before reading it is the
  next step for these; the same would serve slanted labels on root-left trees.
- Pectinate trees whose steps between successive nodes are shorter than the shortest line run
  (about ten pixels) lose those steps; the ink between two close verticals is then no segment.
  `findShortConnectors` recovers such pieces, but switched on it costs the tuned figures more
  than it gives, so it is off (`shortConnectors`) until the attachment rules around it are
  reworked. De Souza 2021 is the case that needs it.

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
- Debris tips were the commonest flaw on real figures: a short unlabelled piece, or one that
  claimed a support value as its label, hanging from a real node. Unlabelled tips with a short
  reach or a tiny line piece, and tips whose only label is a number or a scrap, are dropped;
  anything left is flagged by the quality checks and is one click to delete in the viewer. Every
  real benchmark figure is now identical, so the remaining risk is a real tip whose label was
  not found being dropped as debris; such a tip is short and unlabelled, which the viewer shows.
- On the synthetic benchmark, clean, serif, dense and most touching-label figures come out
  identical. Time-scaled phylograms still lose a few tips where a boxed support label covers
  most of a short branch, or where a range bar extends left past the branch's start; both are
  commoner in the generator than in published figures, but real.
