# Phylogeny figure census (open-paleo-papers corpus, 2026-10-27)

## How the sample was drawn

- **Population.** 1,174 figure captions in 816 papers. A caption line counts if it starts "Fig./Figure N" and its first sentence names a tree: strict consensus, majority-rule, cladogram, MPT, time-scaled or time-calibrated, Bayesian, agreement subtree, or "phylogenetic relationships/position". The eight benchmark papers are excluded.
- **Sample.** 220 figures drawn at random (seed 20261027). 200 were located in their PDF: the script anchors on the caption block, then takes the embedded image next to it, or a 300 dpi page render when the figure is vector art.
- **Losses.** 20 couldn't be located because the PDF has no caption block in its text layer (image-only scans with no OCR layer). That biases the sample against poor scans.
- **Classification.** By eye from contact sheets. 22 of the 200 weren't trees: the wrong image on the caption page (photographs, life restorations), a figure drawn mostly as vector art with only a background band embedded, or a page with only text. That leaves **178 trees**.
- **Accuracy.** The style counts come from thumbnails and are approximate (a few per category). Support values in particular are undercounted: small numbers don't show at thumbnail size.

## Layout

| Layout | n | % of 178 |
|---|---:|---:|
| Rectangular, root left, tips right | 128 | 72 |
| Slanted / diagonal (any orientation) | 24 | 13 |
| Rectangular, vertical (root at bottom; labels usually rotated 90° or set at an angle) | 23 | 13 |
| Circular / radial | 2 | 1 |
| Rectangular, root right (tips on the left) | 1 | <1 |

Most slanted trees are root-at-bottom "V" cladograms, more often in pre-2010 papers. Slanted figures with the root on the left are rare.

## Features (not exclusive)

| Feature | n | % of 178 |
|---|---:|---:|
| Time axis or geological timescale (stage/period bars, Ma ticks, often grey or coloured bands) | 61 | 34 |
| Support values or node numbers visible at thumbnail size (Bremer, bootstrap, node IDs) | 51 | 29 (undercount) |
| Two or more trees in one figure (A/B panels, strict + majority-rule, EW + IW) | 46 | 26 |
| Silhouettes, skull drawings or other taxon artwork next to the tree | 43 | 24 |
| Coloured clade boxes or background bands behind clades (not the timescale) | 27 | 15 |
| Image extracts white-on-black (1-bit mask or spot-ink Separation colour space; see notes) | 14 | 8 |
| Tip labels NOT in the embedded image (set as PDF text over the image) | 9 | 5 |
| Old raster scan with OCR layer | 3 | 2 (undercount, see above) |

## Resolution

- **Source of the figure:** 149 of 178 (84%) are a single embedded raster image. 26 (15%) are vector art, which can be rendered at any resolution. 3 are regions of a page-scan image.
- **Embedded image width (px):** 10th percentile 810, quartiles 1002 / 1405 / 1985, 90th percentile 2230. The smallest seen are about 276–435 px (thumbnails embedded by older journals).
- **Effective resolution on the page:** 10th percentile 150 dpi, quartiles 200 / 300 / 300, 90th percentile 450. Only 4 of 149 are below 150 dpi. 97 (65%) are 300 dpi or more.
- **Glyph height (estimate, not measured):** tip labels are typically set at 5–7 pt. That gives capitals of roughly 15–20 px at 300 dpi and 8–10 px at 150 dpi. Large trees (70+ tips) squeezed onto one page fall to 4–5 pt, which is 5–7 px capitals at 150–200 dpi.

## Notes for the extractor

- **White-on-black images.** 14 of 178 extract inverted, as white lines on black, when the raw image is converted naively. There are two causes. Nine are 1-bit image masks with no colour space: the page paints the "1" pixels in black ink. Five are 8-bit images in a Separation (spot-ink) colour space, where a value of 0 means no ink. PyMuPDF's `Pixmap(doc, xref)` converted to RGB gives the inverted picture in both cases. Invert them, or render the page region instead, which is always correct.
- **Labels missing from the image.** In 9 of 178 the embedded raster holds only the lines, and the taxon names are real PDF text drawn on top. A page render (or the PDF text layer with coordinates) is needed. The text layer then gives exact tip names, with no OCR.
- **Flipped or rotated placement.** 4 of the 149 embedded images are drawn with a placement matrix that flips or rotates them. Three are vertical flips (calvo1995a Fig. 18, müller2017z Fig. 3, lerzo2021a Fig. 2), and one is rotated 90° (sues2014a Fig. 14). A raw extraction comes out upside down, mirrored or sideways. Apply the matrix from `page.get_image_rects(xref, transform=True)`, or render the page.
- **Multi-panel figures** are common (about a quarter). The region option will be needed routinely.
- **Timescale figures** (about a third) usually combine grey or coloured vertical bands, thick range bars on terminal branches, and an axis strip along the bottom.

## The held-out set (17 cases) and how it differs from the census

- **How the cases were chosen:** in the census's random order, a figure was taken if the paper's own matrix or taxon list could be read: from the archive (a printed matrix, 4 cases) or from Europe PMC supplements (13 cases). Nothing was screened for how easy the figure looks.
- **Skipped for having no readable matrix:** the 17 cases come from the first 132 trees in random order. 100 of those 132 are in subscription papers with no matrix in the archive. The held-out set therefore leans heavily toward open-access journals and old papers that print their matrix. Also skipped:
  - han2014a, lü2013a, fiorillo2014a: publish only the new taxon's codings.
  - foth2017a, pol2021a, gallina2019a, poropat2023a, xu2010c: no matrix in their Europe PMC supplements.
  - yu2018a Fig. 5: a hand-drawn summary with abbreviated tips that no matrix lists.
  - brusatte2008b Fig. 11: an area cladogram.
  - tschopp2015a Fig. 119: trees from earlier studies.
  - tschopp2015a Fig. 115: supplement download didn't finish.
- **Layout mix:** 8 rectangular root-left, 6 slanted, 3 vertical. That is more slanted and vertical trees than the census (72 / 13 / 13 %). Printed matrices come from older papers, which favour slanted cladograms.
- **Features:** 6 have a time axis, 5 are multi-panel, 4 have silhouettes, 1 is a 1990s low-resolution scan (calvo1995a, 588 px), and 1 is stored flipped (calvo1995a). One extracts white-on-black (bonaparte2006a; the case image is a page render).
- **Name lists are often supersets of the tips.** Seven cases show only part of a larger analysis, or tips collapsed to clade names (hartman2019a: 501 names, about 60 tips).

## Later notes (2026-10-28)

- **Grey ghost lineages.** han2015a Fig. 11 draws most branch length as pale grey ghost lines (about RGB 200) and only the range bars and node bars in black. A black-ink threshold sees almost none of the tree. It is a figure style of its own: a ghost-lineage chart of the analysis, not the cladogram itself.
- **Wrapped columns.** Three figures flagged multi-panel in the census are one tree wrapped into two columns: fonseca2024a Fig. 2, senter2007a Fig. 4, and cau2021a Fig. 6, where a long connector line joins the columns. A second column is not a second tree; the manifest now runs them whole.
- **Coloured backgrounds.** foth2017a Fig. 9 sits on a solid yellow panel with dashed stage lines; assuming a white background made the orientation step misread it.
