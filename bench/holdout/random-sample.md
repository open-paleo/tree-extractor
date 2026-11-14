# Random gold sample (2026-11-06)

Twenty census figures drawn at random, not chosen for difficulty, so that their scores estimate accuracy on the typical figure. The earlier gold cases were picked because they were hard.

## How the sample was drawn

- **Population:** the 178 census rows with `is_tree: true`, minus the 35 figures that already have a case in `bench/cases/` or `bench/holdout/cases/` (ids compared with accents folded).
- **Strata:** layout (rectangular, slanted, vertical) by whether the figure has a time axis (`time_axis` flag), in roughly the census proportions: rectangular 7 + 7, slanted 1 + 2, vertical 2 + 1 (with + without time axis); 10 with a time axis, 10 without. The census's two circular trees and its one root-right tree are not in any stratum.
- **Draw:** `random.Random(20261106)`; for each stratum in the order above, `rng.sample` of the stratum's rows sorted by id.
- **Pools:** rectangular with time axis 32, rectangular without 81, slanted with 1, slanted without 17, vertical with 12, vertical without 6. The slanted-with-time-axis pool had one figure, so `yu2018a_fig5` came in without a draw.
- **One skip:** `barrett2026a_fig28` (rectangular, time axis) was drawn but not transcribed. Its 76-tip backbone is drawn with 4-px lines set 4 px apart, so neighbouring nodes merge into one solid block, and which branch leaves which node cannot be decided even at 6x. A wrong gold tree would be worse than none. It was replaced from the same stratum's remaining pool by `random.Random(20261107).choice(...)` (seed + 1), which gave `soto-acuña2021a_fig3`. This biases the sample slightly against the densest drawings; it is the only exclusion.

The script, as run:

```python
"""Random gold sample, 2026-11-06: 20 census trees stratified by layout and time axis."""
import json, random, unicodedata
from pathlib import Path
CENSUS = Path.home() / "GitHub/open-paleo/corpus/census/manifest.json"
TE = Path.home() / "GitHub/open-paleo/tree-extractor/bench"
SEED = 20261106
PLAN = {("rectangular", True): 7, ("rectangular", False): 7,
        ("slanted", True): 1, ("slanted", False): 2,
        ("vertical", True): 2, ("vertical", False): 1}
fold = lambda s: unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
have = {fold(p.name) for d in (TE / "cases", TE / "holdout/cases") for p in d.iterdir() if p.is_dir()}
rows = [r for r in json.loads(CENSUS.read_text()) if r.get("is_tree") and fold(r["id"]) not in have]
rng = random.Random(SEED)
for (layout, timed), n in PLAN.items():
    pool = sorted((r for r in rows if r["layout"] == layout and ("time_axis" in r["flags"]) == timed), key=lambda r: r["id"])
    pick = rng.sample(pool, n)
    print(f"{layout:12} time={timed!s:5} pool={len(pool):3}  " + " ".join(r["id"] for r in pick))

# Replacements: a figure that cannot be transcribed reliably is skipped (reason in the note) and
# replaced from the same stratum by a draw with seed SEED+k (k = 1, 2, ...) from the stratum's
# remaining pool, so the replacement is still random.
def replace(layout, timed, exclude, k):
    pool = sorted((r for r in rows if r["layout"] == layout and ("time_axis" in r["flags"]) == timed and r["id"] not in exclude), key=lambda r: r["id"])
    return random.Random(SEED + k).choice(pool)["id"]
if __name__ == "__main__" and "--replace" in __import__("sys").argv:
    first = {"dyer2023a_fig21","barrett2026a_fig28","fiorillo2012a_fig7","gonzálezriga2018a_fig28","alarcón-muñoz2023a_fig5","pérez-pueyo2019a_fig7","longrich2011a_fig11"}
    print("replacement 1 for barrett2026a_fig28:", replace("rectangular", True, first, 1))
```

## Cases

| Case | Layout | Time axis | Tips | Polytomies (children) | names.txt | Open licence | Licence |
|---|---|---|---:|---|---|---|---|
| alarcón-muñoz2023a_fig5 | rectangular | yes | 77 | - | printed | yes | CC BY 4.0 (per the article) |
| arbour2015a_fig1 | rectangular | no | 27 | 3 | printed | no | not open (Taylor & Francis, all rights reserved) |
| averianov2021d_fig23 | rectangular | no | 20 | - | matrix | no | not open (Taylor & Francis, all rights reserved) |
| brusatte2010a_fig2 | vertical | yes | 19 | - | printed | no | not open (Science, all rights reserved) |
| d'emic2012b_fig5 | slanted | no | 28 | 3, 3 | printed | no | not open (Wiley / Linnean Society of London, all rights reserved) |
| dyer2023a_fig21 | rectangular | yes | 18 | 3 | printed | yes | CC BY 4.0 by the journal's policy (VAMP publishes under CC BY 4.0), not stated in the text held |
| fiorillo2012a_fig6 | rectangular | no | 16 | 4 | printed | ? | unverified: no licence statement in the text held (Acta Palaeontologica Polonica is open access) |
| fiorillo2012a_fig7 | rectangular | yes | 16 | - | printed | ? | unverified: no licence statement in the text held (Acta Palaeontologica Polonica is open access) |
| gonzálezriga2018a_fig28 | rectangular | yes | 23 | - | printed | NC | CC BY-NC 3.0 (per the article) |
| ji1998a_fig9 | slanted | no | 8 | 3 | printed | no | not open (Nature, all rights reserved) |
| lockwood2021a_fig23 | rectangular | no | 41 | 3, 11, 3 | printed | NC | CC BY-NC-ND 4.0 (per the article) |
| longrich2011a_fig11 | rectangular | yes | 22 | 3, 3, 3 | printed | no | not open (Elsevier, all rights reserved) |
| lü2013a_fig8 | vertical | no | 20 | 3 | printed | yes | CC BY (Creative Commons Attribution License, per the article; version not stated) |
| mcdonald2018b_fig12 | rectangular | no | 34 | 3, 3, 8 | printed | yes | CC BY 4.0 |
| mo2023b_fig11 | rectangular | no | 109 | 3, 3, 3, 3, 5, 4 | printed | no | not open (Elsevier, all rights reserved) |
| otero2015a_fig19 | vertical | yes | 19 | - | printed | no | not open (Wiley, all rights reserved) |
| pérez-pueyo2019a_fig7 | rectangular | yes | 25 | 4 | printed | ? | unverified: no licence statement in the text held |
| rauhut2012a_fig4 | rectangular | no | 28 | 5, 3 | printed | no | PNAS: freely available, not under an open licence (2012) |
| soto-acuña2021a_fig3 | rectangular | yes | 14 | - | matrix | no | not open (Nature, all rights reserved) |
| yu2018a_fig5 | slanted | yes | 11 | - | printed | yes | CC BY 4.0 |

Open licence: `yes` = CC BY (images may be promoted with attribution); `NC` = a non-commercial licence; `no` = all rights reserved; `?` = no licence statement in the text held (see each case's `license` field).

## How the gold was made

- **Tips:** the printed text, with `_` for spaces. Where the census has the paper's matrix list (`soto-acuña2021a_fig3`, `averianov2021d_fig23`), names.txt is that list. A tip takes the matrix spelling when its printed label is exactly one matrix taxon (`Liaoningosaurus` becomes `Liaoningosaurus paradoxus`; the figure's `Nemegtonicus citus` is the matrix's `Nemegtonykus citus`), and collapsed clades keep their printed names. Everywhere else names.txt is the printed tip names. Printed misspellings and names cut off in the figure are kept as printed; each case's `names_note` lists them.
- **Topology:** read from the figure and checked node by node. For dense trees the node lines were listed from the image itself (each vertical line, the rows where branches leave it, and the row its stem enters), with vertical trees rotated root-left first, and the topology was assembled from that list. The three largest (`alarcón-muñoz2023a_fig5`, 77 tips; `mo2023b_fig11`, 109 tips; `gonzálezriga2018a_fig28`) were done this way, and every polytomy in them was then checked against the figure at 2-6x. That listing is our own reading of the pixels, not tree-extractor output, so the gold stays independent of the tool it measures. `longrich2011a_fig11` was transcribed by hand and also assembled by script, and the two agree.
- **Topology only;** support values, node numbers, dots and bars are not encoded.
- **Uncertain reading:** `ji1998a_fig9`'s root is a trichotomy as read; the other reading is (Velociraptorinae, Protarchaeopteryx). Its gold note explains why.
- **Regions:** `arbour2015a_fig1` (the largest of five trees) and `lockwood2021a_fig23` (panel A of three) carry a `region`.

# Random gold sample 2 (2026-11-14)

Eighty further census figures drawn at random, for tallying lost tips and splits by cause across many figures. Delivered in four batches of twenty.

## How the sample was drawn

- **Population:** the census rows with `is_tree: true`, minus every figure that already had a case in `bench/cases/` or `bench/holdout/cases/` when drawn (ids compared with accents folded): 132 rows, 129 of them in the six layout strata (the circular and root-right trees are not in any stratum).
- **Strata:** layout (rectangular, slanted, vertical) by time axis, as in sample 1. Here the 80 were allocated in proportion to the pools (largest remainder): rectangular 16 + 46, slanted 0 + 9, vertical 6 + 3 (with + without time axis). The slanted-with-time-axis pool was empty.
- **Draw:** `random.Random(20261114)`; for each stratum in the order above, `rng.sample` of the stratum's rows sorted by id. The 80 were then shuffled with `random.Random(20261114 + 1000)` into four batches, so each batch spans the strata.
- **Skip rule:** as in sample 1: a figure whose topology cannot be decided is skipped, its reason recorded here, and replaced from its stratum's remaining pool by a draw with seed 20261114 + k.
- **Gold method:** each case.json has `gold_method`: `image-transcription` (read from the figure image, by eye from 1-2x crops or from a listing of node lines taken from the pixels) or `pdf-vector` (read from the PDF's own vector branch lines, with tip names read from the figure).

The script, as run:

```python
"""Random gold sample 2, 2026-11-14: 80 further census trees, stratified by layout and time axis."""
import json, random, unicodedata, collections
from pathlib import Path
CENSUS = Path.home() / "GitHub/open-paleo/corpus/census/manifest.json"
TE = Path.home() / "GitHub/open-paleo/tree-extractor/bench"
SEED = 20261114
N = 80
fold = lambda s: unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
have = {fold(p.name) for d in (TE / "cases", TE / "holdout/cases") for p in d.iterdir() if p.is_dir()}
rows = [r for r in json.loads(CENSUS.read_text()) if r.get("is_tree") and fold(r["id"]) not in have]
strata = collections.defaultdict(list)
for r in rows:
    if r["layout"] in ("rectangular", "slanted", "vertical"):
        strata[(r["layout"], "time_axis" in r["flags"])].append(r)
total = sum(len(v) for v in strata.values())
# allocate N proportionally (largest remainder), each stratum capped at its pool
alloc = {k: N * len(v) / total for k, v in strata.items()}
plan = {k: int(a) for k, a in alloc.items()}
for k in sorted(alloc, key=lambda k: alloc[k] - plan[k], reverse=True)[: N - sum(plan.values())]: plan[k] += 1
rng = random.Random(SEED)
order = [("rectangular", True), ("rectangular", False), ("slanted", True), ("slanted", False), ("vertical", True), ("vertical", False)]
picks = []
for k in order:
    pool = sorted(strata.get(k, []), key=lambda r: r["id"])
    n = min(plan.get(k, 0), len(pool))
    pick = rng.sample(pool, n) if n else []
    print(f"{k[0]:12} time={k[1]!s:5} pool={len(pool):3} drawn={n:2}  " + " ".join(r["id"] for r in pick))
    picks += [(k, r["id"]) for r in pick]
print("population", len(rows), "in strata", total, "drawn", len(picks))
# batch order: interleave strata so each batch of 20 spans them
rng2 = random.Random(SEED + 1000); batch_order = [p[1] for p in picks]; rng2.shuffle(batch_order)
json.dump({"picks": picks, "batch_order": batch_order}, open(Path(__file__).with_name("draw.json"), "w"), ensure_ascii=False)
for i in range(0, len(batch_order), 20): print(f"batch {i//20+1}:", " ".join(batch_order[i:i+20]))
def replace(k, exclude, j):
    pool = sorted((r for r in strata[k] if r["id"] not in exclude), key=lambda r: r["id"])
    return random.Random(SEED + j).choice(pool)["id"]
```

## Batch 1 (20 cases, no skips)

| Case | Layout | Time axis | Tips | Polytomies (children) | Clade labels | names.txt | Gold method | Open licence |
|---|---|---|---:|---|---:|---|---|---|
| xu2010c_fig9 | rectangular | no | 23 | 3 | - | printed | image-transcription | yes |
| han2024a_fig7 | rectangular | yes | 68 | 3, 3, 5, 3, 3 | - | matrix | pdf-vector | no |
| carpenter2018b_fig3 | vertical | no | 8 | - | 6 | printed | image-transcription | ? |
| manitkoon2023a_fig19 | rectangular | no | 74 | 3, 3, 3, 6, 3, 10, 6, 4 | 9 | printed | image-transcription | yes |
| ramírez-velasco2021a_fig19 | rectangular | yes | 92 | 4, 5, 5, 9, 4, 4, 3, 4, 3 | 13 | printed | image-transcription | no |
| maidment2020a_fig12 | rectangular | yes | 23 | 3, 3 | - | printed | image-transcription | no |
| yates2007a_fig8 | rectangular | no | 44 | 3, 3, 4, 4 | 14 | printed | image-transcription | no |
| poust2020a_fig10 | rectangular | yes | 21 | 7, 4, 5 | 3 | printed | image-transcription | no |
| funston2026a_fig4 | vertical | yes | 19 | - | 1 | printed | image-transcription | yes |
| sues2014a_fig14 | rectangular | no | 26 | 10, 4, 4, 5 | - | printed | image-transcription | no |
| turner2007b_fig5 | rectangular | no | 58 | 3, 3, 3, 8, 3, 11 | 1 | printed | image-transcription | ? |
| serrano-brañas2016a_fig11 | rectangular | no | 12 | 5 | - | printed | image-transcription | no |
| gomez2024a_fig27 | rectangular | yes | 14 | - | 8 | matrix | image-transcription | no |
| cerroni2022a_fig15 | rectangular | no | 42 | 35 | 3 | matrix | image-transcription | no |
| poropat2014a_fig24 | rectangular | no | 36 | - | 5 | printed | image-transcription | no |
| tschopp2015a_fig117 | rectangular | no | 77 | 3, 3, 7 | 5 | matrix | pdf-vector | yes |
| d'emic2012b_fig3 | slanted | no | 7 | - | - | printed | image-transcription | no |
| pu2017a_fig6 | rectangular | no | 37 | 9, 3 | 4 | printed | image-transcription | yes |
| prieto-márquez2012d_fig13 | rectangular | no | 70 | 3, 3, 4, 3, 3, 8, 10, 3, 4, 5 | 6 | printed | image-transcription | no |
| czepiński2023a_fig6 | rectangular | no | 16 | 3, 3 | 3 | printed | image-transcription | yes |

Notes on batch 1:

- `pu2017a_fig6`: the census image is cropped at the right and cuts off seven tips; the gold was read from a page render and has all 37 (the caption's taxon count). Its case.json carries an `image_note`.
- `sues2014a_fig14` is listed as rectangular in the census but is drawn with diagonal branches.
- `prieto-márquez2012d_fig13` prints *Microraptor gui* twice; the lower one is `Microraptor_gui_2`.
- `gomez2024a_fig27`, `cerroni2022a_fig15`, `han2024a_fig7` and `tschopp2015a_fig117` have matrix lists; their tips take the list spelling, with every mapping in `names_note`.
- `ramírez-velasco2021a_fig19` and `turner2007b_fig5`: parts of the pixel listing failed (dotted leaders and markers; a box frame) and those parts were read by eye, as each gold_note says.
