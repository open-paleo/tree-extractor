# tree-extractor

Extracts phylogenetic trees from figure images and writes them as Newick and Nexus. Built for the
[Open Paleo](https://github.com/open-paleo) project, where published cladograms are the only
machine-unreadable source for many fossil groups, but general enough for any rectangular tree
figure.

Everything runs in TypeScript with no native image library and no machine-learning model: the
figure is reduced to dark pixels, its straight lines are traced into a graph, and labels are read with
[Tesseract.js](https://github.com/naptha/tesseract.js) and matched against a list of taxon names
when one is supplied. The same core runs in the browser and in Node, so the interactive viewer and
the batch command line give identical results.

## Status

Early. On eight published figures (a 52-taxon time-scaled consensus with colored clade boxes and
range bars; a 20-taxon strict consensus from a 665-pixel-wide embedded image; a 300 dpi page scan
of a 1990s-style cladogram in italic serif; a 75-taxon majority-rule tree in a staircase layout
with clade arrows; a 68-taxon consensus with Bremer values and lettered clades; a 17-taxon
time-scaled turtle tree; a 60-tip tree at 2265 by 4500 pixels with 35-pixel letters; and a
74-taxon tree in a letter-spaced italic font with a red new taxon) all eight come out identical.
On synthetic figures in five styles, twelve of fifteen are identical. Four of the real figures are CC BY and
ship with the benchmark; see `bench/README.md` for the rest and `docs/design.md` for the approach
and its known gaps.

## Use

Requires Node 24 or later.

```sh
npm install

# Batch: one image in, Newick + Nexus + JSON document out, with a QC report on stdout
npm run extract -- extract figure.png --names taxa.txt --out results/ --overlay

# Interactive: build the browser bundle and serve the viewer at http://localhost:8787/src/web/
npm run web
```

`--crop x,y,w,h` restricts the analysis to one region of the image (for example to leave out a
time scale or a second panel); results are still reported in full-image coordinates.

`--names` is a text file with one taxon name per line (for example the taxa of the paper's
character matrix). OCR output is fuzzy-matched against it, which turns imperfect reads of small
italic text into exact names. Without a list the raw OCR text is kept and uncertain tips are
flagged.

The viewer runs the same pipeline on a dropped image, in a Web Worker so the page stays
responsive, and draws what it found over the figure.
Scroll to zoom, drag to pan, and use *Select region* to mark where the tree is when the figure
holds more than the tree. Clicking a tip or node on the canvas selects it in the lists and the
other way round; labels are editable in place and the Newick updates. Missed or spurious
elements can be fixed by hand: *Add tip* then click a branch end, *Add node* then drag along the
missing vertical connector (it takes over the branches it crosses), and *Delete* removes the
selected tip or node, dissolving a node into its parent. Re-parenting by drag is not there yet.

## Scope

First release: rectangular trees (cladograms and phylograms) with the root on the left and tips
on the right, tip labels, support values at nodes, polytomies. When a time axis with readable
numbers is found, nodes and tips get ages and the Newick carries branch lengths in the axis's
units. Not yet: slanted or circular trees, branch lengths without an axis.

## Development

```sh
npm test            # unit tests (node:test)
npm run bench       # benchmark against gold trees; see bench/README.md for supplying images
npm run bench:generate   # render synthetic figures in several styles for the benchmark
npm run lint        # eslint, same style as the other Open Paleo repositories
npm run typecheck
```

Code style follows the Open Paleo conventions (Allman braces, four-space indent, `type` over
`interface`, no abbreviated names, JSDoc on everything exported).

## License

MIT. Tesseract.js is Apache-2.0; sharp (used only by the command line for image decoding) is
Apache-2.0.
