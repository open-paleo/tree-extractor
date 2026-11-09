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
