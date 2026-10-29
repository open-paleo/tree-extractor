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

Early. Eighteen published figures are in the benchmark: eight the pipeline was tuned on, which
all come out identical, and ten drawn at random from the Open Paleo corpus and run cold first,
of which two (a three-panel ceratopsian figure and a tyrannosauroid tree with range bars and
collapsed clades) are identical, two name every tip (a 19-tip abelisaurid tree and a 30-tip
centrosaurine tree with numbered node discs, range ovals and silhouettes, which names 29) and
two have most of their tree right (a 52-tip paravian time tree names 50). A census of 178 tree
figures from the same corpus (`bench/holdout/census.md`) puts rectangular root-left trees at
72 percent, slanted at 13 and vertical at 13. Vertical trees are turned a quarter and traced
like the rest, labels set at a slant are read in a level frame of their own (the four vertical
figures in `bench/holdout/` come out with 12 of 12, 10 of 12, 15 of 19 and 44 of 52 tips
named, cold), and slanted trees are read from the skeleton of their line art (of the four with
gold, a 28-tip diplodocoid cladogram names 27 with 14 of 16 splits, a 20-tip titanosaur
cladogram names all 20 with all its splits, and a 55-tip sauropod cladogram names 45 with 29
of 35; see `docs/design.md`). On synthetic figures in five styles,
thirteen of fifteen are identical. Ten of the real figures are openly licensed and ship with the
benchmark; see `bench/README.md` for the rest and `docs/design.md` for the approach and its
known gaps.

Across the whole census, run cold with the batch runner (`bench/batch.ts`), 178 trees
give 168 trees of three tips or more and no crashes, at 3 seconds a figure: rectangular
figures a median of 27 tips, slanted 11, vertical 14. On the 28 census figures with a
taxon list, 88 percent of the traced tips carry an accepted name. Those numbers are
what the pipeline does unseen; the benchmark below is what it does on figures it was tuned on.

## Use

Requires Node 24 or later.

```sh
npm install

# Batch: one image in; Newick, Nexus, a redrawn SVG and the JSON document out, with a QC report on stdout
npm run extract -- extract figure.png --names taxa.txt --out results/ --overlay

# Interactive: build the browser bundle and serve the viewer at http://localhost:8787/src/web/
npm run web
```

`--crop x,y,w,h` restricts the analysis to one region of the image (for example to leave out a
time scale or a second panel); results are still reported in full-image coordinates.

`--names` is a text file with one taxon name per line (for example the taxa of the paper's
character matrix). OCR output is fuzzy-matched against it, which turns imperfect reads of small
italic text into exact names. A label the list does not explain is then offered to the known
taxa of the Open Paleo data set (`names/known-taxa.txt`, every genus, species and synonym) at a
stricter threshold, and a match from there is flagged in the quality checks as coming from
outside the paper's own taxa; `--known-names` substitutes another list and `--no-known-names`
skips the tier. Without any list the raw OCR text is kept and uncertain tips are flagged.

The viewer runs the same pipeline on a dropped image, in a Web Worker so the page stays
responsive, and draws what it found over the figure.
Scroll to zoom, drag to pan, and use *Select region* to mark where the tree is when the figure
holds more than the tree. Clicking a tip or node on the canvas selects it in the lists and the
other way round; labels are editable in place and the Newick updates. Missed or spurious
elements can be fixed by hand: *Add tip* then click a branch end, *Add node* then drag along the
missing vertical connector (it takes over the branches it crosses), and *Delete* removes the
selected tip or node, dissolving a node into its parent. Re-parenting by drag is not there yet.
Below the Newick, the traced tree is redrawn clean: root on the left, tips evenly spaced, branch
lengths from the time axis when one was read. It updates with every edit, doubles as a check on
the trace, and downloads as SVG, so a figure that went in on its side with silhouettes and bands
comes out as a plain horizontal tree.

## Scope

First release: rectangular trees (cladograms and phylograms) with the root on the left and tips
on the right, or drawn on their side with the root at the bottom or top (these are turned
first), tip labels, support values at nodes, polytomies. When a time axis with readable
numbers is found, nodes and tips get ages and the Newick carries branch lengths in the axis's
units. Not yet: circular trees, branch lengths without an axis.

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
