# Figure profiles: a sketch

Status: approach agreed 2026-10-27 (overrides live in `Parameters`; the core stays pure and a
rerun is a plain extraction). Step 1 (measure and record) is built in `src/core/profile.ts`.
Step 2 moved the first decisions onto the profile: the text-ink widening is recorded in the
profile and can be forced either way (`widenText`), label crops are condensed by the figure's
letter gap rather than per label (`condensing`), and the number of gaps the collinear merge
bridged is recorded. The profile is now measured before labels are read, and the parts that
read text can change are measured again after. The CLI takes `--profile key=value,...`.

A correction from the first measurements: Madzia 2019, which this document called a staircase
layout, is centered. Its parent branches meet their verticals mid-span like everyone else's;
what looked like a staircase was long verticals with tips at many depths. No benchmark figure is
a staircase layout, so that branch of the tracer work waits for one.

## Why

Eight real figures are identical on the benchmark, but several of the fixes that got them
there are rules that happen to be safe on all eight rather than rules that follow from what
the figure is. Examples: the collinear-merge step bridges gaps because some figures put white
label boxes on branches, and had to learn not to bridge the empty gaps of a staircase layout;
label crops are condensed when letters are spaced apart; the column-height cut under a support
label is right when labels sit above branches and wrong when they sit on them. Each of these is
a property of the whole figure, decided today pixel by pixel.

A figure profile makes those properties explicit: a handful of named features, measured once
after the rough passes, recorded in the document, shown in the viewer, and read by the steps
that care. Downstream code then branches on a fact about the figure instead of on a threshold
that was tuned until every benchmark case passed.

## What step 1 found

Measured on the eight real figures and fifteen synthetic ones (2026-10-27):

- Layout, tip alignment, support label style, clade letters and discs, bands, range bars and
  the time axis come out as expected on every real figure where the expectation is firm.
- Slant separates italic from upright on every real figure (glyph heights 12 to 35 px). Below
  about 11 px the lean is a pixel or less across a letter and the measurement is noise, so it is
  reported as unmeasured rather than guessed; the synthetic presets at 8 to 10 px fall there.
- Panels are the least settled feature: blocks of line art at least a fifth of the image in
  both directions, joined when closer than two glyph heights, with the traced tree's skeleton
  added so that a tree is one block however its drawing is cut. Raven's clade brackets come out
  as a second block, which is right; Dieudonné reports a second block inside the tree's own
  extent and Ke's stratigraphic chart does not separate from the tree, so neither case states
  a panel expectation yet. A figure whose tree came out in disconnected pieces reports each
  piece.
- Letter spacing: Yang's font measures 0.67 glyph heights between letters; every other figure
  0.03 to 0.17.
- Range bars are found by comparing the ink height at the right end of a tip branch with its
  left part, not by thickness against the line thickness, since Ke's branches are drawn thicker
  at the tip than the global thickness estimate allows for.

## What the profile holds

The built shape is `FigureProfile` in `src/core/types.ts`: line thickness; layout (centered,
staircase, unknown) with a vote margin; tip alignment (aligned, the shared x, the share of tips
at it); support label style (none, above-branch, boxed-on-branch, at-node, unknown) with a
margin; clade marks (letters, discs); font (stroke width, letter gap as a fraction of the glyph
height, slant or null, italic or null, letter-spaced); time-scale signs (tinted share, share of
columns tinted top to bottom, bands, axis box, range bar count); panel boxes; and the list of
features the caller overrode. Brackets and arrows are not measured yet.

Every field has an `unknown` or empty value, and the pipeline with an all-unknown profile must
behave exactly as it does today. That is the migration rule: the profile adds decisions, it does
not replace the current ones until a benchmark case shows the profile-driven choice is better.

## How each feature is measured

All of these use data the pipeline already computes; none needs a new pass over the pixels.

| Feature | Signal | When it is known |
|---|---|---|
| layout | For every vertical with a parent branch, where along its span the parent arrives: near an end (staircase) or inside (centered). Take the majority after the first trace. | after trace |
| tipAlignment | Histogram of right ends of tip branches; aligned when one bin holds most of them. | after trace |
| supportLabels | Small text rows (one to three glyphs, digits) near junctions: above and left of the vertical, centered on a branch with white around them, or touching the node. Majority vote. | after label assignment |
| cladeMarks | Letters alone near junctions (Hattori), filled discs of roughly glyph size on verticals (Yang), thick curved strokes (Madzia brackets, arrows). Discs and curves come from component shape in the line ink: fill ratio near one for discs, low straightness for curves. | after rough text pass |
| font | Stroke width from the median run length of glyph pixels; letter gap from the blank columns between glyphs in long rows (what `chooseCondensing` measures per label); italic from the mean slant of tall glyphs. | after rough text pass |
| timeScaled | Bands: wide low-chroma or pastel regions spanning most of the height. Axis: a long horizontal near the bottom with regularly spaced short verticals and digit rows. Range bars: horizontals two or more times the line thickness ending at tips. | before trace |
| panels | Connected clusters of line art after glyph removal; two clusters of tree-like aspect are two panels. | before trace |

Confidence is the margin of the vote, kept so the viewer can show a shaky guess differently
from a firm one.

## What each step does with it

- **Region.** Two panels: the CLI takes `--panel`, the viewer offers the two boxes. A time axis
  is excluded from the region and kept for calibration.
- **Masks.** Range bars present: the thick-stretch rule in `findLinePieces` keeps even thick
  stretches as line; otherwise it may split them, which removes a source of false verticals on
  figures that have no bars. Hairline font: text hysteresis on; bold font: off. This replaces the
  `fragmented` guess with a measurement.
- **Segments.** Boxed support labels: bridge collinear gaps that contain ink, as now. Labels above
  branches: do not cut a branch where tall ink sits above it with a clear gap, which is the cut
  that shortened Madzia's branch. No support labels: never bridge.
- **Trace.** Staircase layout: a parent branch is expected at the top of a vertical and the first
  child continues on the same line, so a branch running straight through the top of a vertical is the
  parent on the left and the first child on the right, not a crossing. Centered layout: the
  present rules. Aligned tips: a branch ending well short of the tip line with no label is not a
  tip, and a label row at the tip line with no branch is a missed tip that the trace should look
  for at a lower threshold before giving up.
- **Labels and OCR.** Letter gap wide: condense crops, as now but decided once. Italic: pass the
  Tesseract italic hint. Clade letters: text rows of one letter at junctions are clade marks, not
  support values, and are recorded as such in the document rather than read as labels.
- **Debris.** Brackets and arrows detected: paint them out before tracing, which removes the tip of
  the bracket at the source instead of in `removeDebrisTips`.
- **QC.** Report profile-level inconsistencies: a tip off the alignment line, a support label with
  no node, a panel with no tree.

## Where it lives

- `src/core/profile.ts`: `measureProfile(...)`, called twice from `extractTree`: once before the
  trace with what is known then, once after the trace to fill `layout` and `tipAlignment`.
- `ExtractionDocument.profile`: the measured profile. `Parameters.profile`: optional overrides,
  so the CLI (`--profile layout=staircase`) and the viewer can force a value and rerun.
- Viewer: a small panel under the QC list showing each feature, its confidence, and a control to
  override it. Overriding reruns extraction in the worker with the override in `Parameters`.
- Benchmark: `case.json` gains an optional `profile` block with the expected values. The runner
  reports profile accuracy as its own column, so a wrong guess shows up even when the tree still
  comes out identical.

## Order of work

1. Measure and record only. Add `profile.ts`, fill the document, show it in the viewer, add
   expected profiles to the eleven existing cases. No behavior changes. This alone tells us which
   features are measurable reliably.
2. Move the three decisions that already exist in disguise onto the profile: text hysteresis
   (font), label condensing (font), gap bridging (supportLabels). The strict benchmark must not
   change. Done for the first two; gap bridging stays on its ink-in-the-gap rule, because the
   support label style is only known after the trace that the bridging feeds, and the count of
   bridged gaps is recorded instead until a figure needs an earlier decision.
3. Layout-aware tracing for staircase figures, with a second staircase figure in the benchmark
   before the rule is written.
4. Tip alignment as a consistency check and a second chance for missed tips. Done: on an
   aligned figure, a tip of the tree ending more than a glyph height from the line is reported
   (`tip-off-line`), a label row at the line that no tip owns is reported (`row-without-tip`),
   and before labels are read such a row is searched for in the line ink; a branch piece ending
   at the line gets a tip (`tip-recovered`), hung from the nearest node on its left. No
   benchmark figure exercised the recovery, which is tested on a built document.
5. Decoration removal (brackets, arrows, discs) before tracing. Done in the form the evidence
   supported: after the trace, a disconnected piece that lies entirely right of the tips, or
   above or below the tree with no labels, is dropped (`decoration-dropped`) before any label of
   its is read. That is where Raven's and Yang's clade brackets and Dieudonné's time axis
   traced to. Recognizing brackets, arrows and discs by shape before tracing was not needed by
   any benchmark figure and waits for one.
6. Time-scale detection, which is also the entry point for the v2 branch-length calibration.
   First slice done: the axis is found from its tick marks (a row that many short verticals
   start or end on, or a long horizontal near an edge, with ink ticks in the band beside it),
   the numbers along it are read after the labels, standing up or turned a quarter either way,
   each goes with its nearest tick, and a least-squares line gives columns per unit and the
   column of value zero. The result is recorded as `timeScaled.calibration`; nothing uses it
   yet. Ke 2023 calibrates from four labels at 27 px per million years with half a pixel of
   residual. Dieudonné 2026 does not: its axis numbers are eight pixels high, straddle the
   axis line, and touch their ticks and one another, and the reads come out in pieces. The
   axis line's own rows and the tick marks are blanked before the labels are stacked and read,
   which was enough for Ke and not for that. Branch lengths in time from the calibration are
   the next slice.

Each step is one commit and one or two new benchmark figures chosen for the feature.

## Risks

- A wrong profile value is worse than no profile, because it changes behavior across the whole
  figure. Hence the `unknown` default, the confidence margin, and the viewer override.
- Features that are mixed within one figure (a few boxed labels among above-branch ones, or a
  time-scaled inset) defeat a majority vote. The profile should be per panel, and the steps that
  use it should fall back to the current local rules when the vote margin is small.
- Slanted and circular trees are a layout value too, but one where the whole rectangular tracer
  is the wrong tool. Detecting them (few long horizontals, many diagonal runs) and saying so in
  QC is cheap and worth doing early; tracing them is the v2 work already deferred.
