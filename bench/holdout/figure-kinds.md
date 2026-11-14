# How the census trees are drawn in their PDFs

For tree-extractor. Measured 2026-11-14 on the 178 census figures marked as trees (the 22 non-trees are listed at the end), from each figure's PDF page:

- **vector**: branch lines are PDF path segments (the census rendered the page region; the PDF holds no raster image for it).
- **raster**: the tree is a raster image. `embedded` = the PDF's own image at native resolution; `rendered` = an image the census rendered from the page; `page scan` = the whole page is a scan.
- **mixed**: a raster image with real text labels placed over it (no case found of vector lines over a raster tree).
- **labels**: `text` = tip names are extractable text (genus names found on the page); `outlined` = drawn as glyph outlines or absent from the text layer; `in image` = part of the raster.

## Totals (178 trees)

| kind | figures |
|---|---|
| vector | 26 |
| raster | 147 |
| mixed | 5 |

Vector trees with text labels: 19; with outlined or missing labels: 7.

## By publication year

| years | vector | raster | mixed |
|---|---|---|---|
| before 2000 | 0 | 4 | 0 |
| 2000–2009 | 2 | 20 | 0 |
| 2010–2019 | 16 | 62 | 2 |
| 2020– | 8 | 59 | 2 |
| undated | 0 | 2 | 1 |

Vector figures are a minority in every decade (none before 2000, about a fifth of 2010–2019, an eighth since 2020): most journals still embed the tree as an image, so a PDF reader would sit in front of the image pipeline for roughly 15% of figures, not replace it.

Uncertain rows: `rauhut2012a_fig4` (two images on the page; the text inside may be prose), and `sekiya2013a_fig40`, `yates2003a_fig4`, `dai2022a_fig9` (words over the image but no genus names; kept as raster). The vector `outlined` rows (all of `turner2012a`, `tschopp2015a_fig115`, `han2024a_fig7`, `zheng2018a_fig10`) have their tip names as glyph outlines, so reading them from the PDF gives the branches but not the names.

## Per figure

| id | kind | labels | year |
|---|---|---|---|
| agnolín2023a_fig11 | raster | in image | 2023 |
| alarcón-muñoz2023a_fig5 | raster | in image | 2023 |
| arbour2015a_fig1 | raster | in image | 2015 |
| arbour2015a_fig12 | raster | in image | 2015 |
| arcucci2003a_fig4 | raster (rendered region) | in image | 2003 |
| augustin2023a_fig3 | raster | in image | 2023 |
| averianov2006a_fig25 | raster (page scan) | in image (OCR layer only) | 2006 |
| averianov2010a_fig9 | raster | in image | 2010 |
| averianov2021b_fig4 | raster | in image | 2021 |
| averianov2021d_fig23 | raster | in image | 2021 |
| baiano2020a_fig8 | raster | in image | 2020 |
| barker2021a_fig7 | mixed: text labels over raster | text | 2021 |
| barrett2007a_fig10 | raster | in image | 2007 |
| barrett2026a_fig28 | raster | in image | 2026 |
| bell2015b_fig5 | raster | in image | 2015 |
| bellardini2025a_fig9 | raster | in image | 2025 |
| bonaparte2006a_fig8 | raster (rendered region) | in image | 2006 |
| brown2011a_fig23 | raster | in image | 2011 |
| brusatte2008b_fig11 | raster | in image | 2008 |
| brusatte2010a_fig2 | vector | text | 2010 |
| calvo1995a_fig18 | raster (rendered region) | in image | 1995 |
| carpenter2018b_fig3 | raster | in image | 2018 |
| cau2021a_fig6 | raster | in image | 2021 |
| cerroni2019a_fig8 | raster | in image | 2019 |
| cerroni2022a_fig15 | raster | in image | 2022 |
| coria2016a_fig30 | raster | in image | 2016 |
| csiki2010a_fig6 | raster (rendered region) | in image | 2010 |
| czepiński2023a_fig6 | vector | text | 2023 |
| d'emic2012b_fig3 | raster | in image | 2012 |
| d'emic2012b_fig5 | raster | in image | 2012 |
| dai2022a_fig9 | raster (rendered region) | in image | 2022 |
| dallavecchia2006a_fig20 | raster | in image | 2006 |
| dalsasso2011a_fig113 | raster (rendered region) | in image | 2011 |
| desouza2021a_fig6 | raster | in image | 2021 |
| dyer2023a_fig20 | raster | in image | 2023 |
| dyer2023a_fig21 | raster | in image | 2023 |
| díezdíaz2021a_fig12 | raster | in image | 2021 |
| fanti2015a_fig21 | raster | in image | 2015 |
| fanti2015a_fig23 | raster | in image | 2015 |
| fiorillo2012a_fig6 | vector | text | 2012 |
| fiorillo2012a_fig7 | vector | text | 2012 |
| fiorillo2014a_fig6 | raster | in image | 2014 |
| fonseca2024a_fig2 | raster | in image | 2024 |
| foth2017a_fig9 | raster | in image | 2017 |
| foth2025a_fig16 | raster | in image | 2025 |
| fowler2020a_fig9 | raster | in image | 2020 |
| funston2026a_fig4 | raster | in image | 2026 |
| gallina2014a_fig4 | raster | in image | 2014 |
| gallina2019a_fig3 | raster | in image | 2019 |
| galton2007a_fig3 | raster | in image | 2007 |
| gates2021a_fig14 | raster | in image | 2021 |
| gauthier1986a_fig8 | raster (page scan) | in image (OCR layer only) | 1986 |
| gianechini2015a_fig8 | vector | text | 2015 |
| gomez2024a_fig27 | raster | in image | 2024 |
| gonzálezriga2018a_fig28 | raster | in image | 2018 |
| han2014a_fig11 | raster | in image | 2014 |
| han2014b_fig5 | vector | text | 2014 |
| han2015a_fig11 | raster | in image | 2015 |
| han2018a_fig16 | raster | in image | 2018 |
| han2024a_fig7 | vector | outlined or absent (check) | 2024 |
| hartman2019a_fig18 | raster | in image | 2019 |
| hendrickx2024a_fig16 | raster | in image | 2024 |
| hu2009a_fig4 | vector | text | 2009 |
| hu2017z_fig9 | raster | in image |  |
| hwang2004a_fig12 | raster (page scan) | in image (OCR layer only) | 2004 |
| isasmendi2024a_fig9 | raster | in image | 2024 |
| ji1998a_fig9 | raster (rendered region) | in image | 1998 |
| kobayashi2003b_fig27 | vector | text | 2003 |
| kuzmin2020a_fig20 | raster | in image | 2020 |
| lefèvre2014a_fig10 | raster | in image | 2014 |
| lerzo2021a_fig2 | raster (rendered region) | in image | 2021 |
| li2024a_fig8 | raster | in image | 2024 |
| lockwood2021a_fig23 | raster | in image | 2021 |
| loewen2024a_fig24 | raster | in image | 2024 |
| longrich2009a_fig3 | raster | in image | 2009 |
| longrich2011a_fig11 | raster | in image | 2011 |
| läng2010a_fig22 | raster | in image | 2010 |
| lü2013a_fig8 | raster | in image | 2013 |
| lü2014a_fig5 | vector | text | 2014 |
| ma2026a_fig4 | raster | in image | 2026 |
| magyar2026a_fig14 | raster | in image | 2026 |
| maidment2020a_fig12 | raster | in image | 2020 |
| manitkoon2023a_fig19 | raster | in image | 2023 |
| mannion2011b_fig12 | raster | in image | 2011 |
| martínez2009b_fig10 | raster | in image | 2009 |
| mateus2011a_fig6 | raster | in image | 2011 |
| mcdonald2018b_fig12 | raster | in image | 2018 |
| meso2024a_fig6 | raster | in image | 2024 |
| mo2023b_fig11 | raster | in image | 2023 |
| mocho2016a_fig22 | raster | in image | 2016 |
| mocho2023a_fig24 | raster | in image | 2023 |
| mocho2024a_fig3 | raster | in image | 2024 |
| morschhauser2018a_fig13 | raster | in image | 2018 |
| motta2025a_fig5 | raster | in image | 2025 |
| moutrille2025a_fig16 | raster | in image | 2025 |
| müller2017z_fig3 | raster (rendered region) | in image |  |
| müller2018b_fig40 | raster | in image | 2018 |
| müller2018z_fig1 | mixed: text labels over raster | text |  |
| müller2020b_fig1 | raster | in image | 2020 |
| naish2022a_fig37 | raster | in image | 2022 |
| novas2012a_fig7 | raster | in image | 2012 |
| novas2013a_fig8 | raster | in image | 2013 |
| otero2015a_fig19 | raster | in image | 2015 |
| pacheco2019a_fig8 | raster | in image | 2019 |
| penkalski2018a_fig16 | raster | in image | 2018 |
| penkalski2026a_fig14 | raster | in image | 2026 |
| peyredefabrègues2015a_fig7 | raster | in image | 2015 |
| pol2020a_fig3 | raster | in image | 2020 |
| pol2021a_fig3 | raster | in image | 2021 |
| pol2022a_fig6 | raster | in image | 2022 |
| poole2022a_fig6 | raster | in image | 2022 |
| poropat2014a_fig24 | raster | in image | 2014 |
| poropat2023a_fig30 | vector | text | 2023 |
| poust2020a_fig10 | raster | in image | 2020 |
| pretto2018a_fig11 | raster | in image | 2018 |
| prieto-márquez2012d_fig13 | raster | in image | 2012 |
| prieto-márquez2013c_fig26 | raster | in image | 2013 |
| pu2017a_fig6 | mixed: text labels over raster | text | 2017 |
| pérez-pueyo2019a_fig7 | raster | in image | 2019 |
| qiu2025a_fig3 | vector | text | 2025 |
| ramírez-velasco2021a_fig19 | raster | in image | 2021 |
| rauhut2012a_fig4 | mixed: text labels over raster | text | 2012 |
| rauhut2016b_fig25 | raster | in image | 2016 |
| rauhut2017a_fig10 | raster (rendered region) | in image | 2017 |
| rauhut2019a_fig4 | raster | in image | 2019 |
| rauhut2024a_fig26 | raster | in image | 2024 |
| ren2020b_fig6 | raster | in image | 2020 |
| rivera-sylva2024a_fig12 | vector | text | 2024 |
| sampson2010a_fig7 | raster | in image | 2010 |
| scannella2014a_fig3 | raster | in image | 2014 |
| schott2016a_fig28 | vector | text | 2016 |
| sekiya2013a_fig40 | raster (rendered region) | in image | 2013 |
| sellés2021a_fig3 | raster | in image | 2021 |
| senter2007a_fig4 | raster | in image | 2007 |
| sereno1997a_fig6 | raster | in image | 1997 |
| sereno2012a_fig104 | raster | in image | 2012 |
| serrano-brañas2016a_fig11 | raster | in image | 2016 |
| shan2025a_fig9 | raster | in image | 2025 |
| silvajunior2022a_fig23 | raster | in image | 2022 |
| soto-acuña2021a_fig3 | vector | text | 2021 |
| sues2014a_fig14 | raster (rendered region) | in image | 2014 |
| sues2016a_fig26 | raster | in image | 2016 |
| sánchez-fenollosa2025a_fig5 | raster | in image | 2025 |
| tan2021a_fig8 | raster | in image | 2021 |
| thompson2011a_fig2 | raster | in image | 2011 |
| torcidafernández-baldor2011a_fig14 | vector | text | 2011 |
| tschopp2015a_fig115 | vector | outlined or absent (check) | 2015 |
| tschopp2015a_fig117 | vector | text | 2015 |
| tschopp2015a_fig119 | raster | in image | 2015 |
| turner2007b_fig5 | raster | in image | 2007 |
| turner2012a_fig65 | vector | outlined or absent (check) | 2012 |
| turner2012a_fig68 | vector | outlined or absent (check) | 2012 |
| turner2012a_fig70 | vector | outlined or absent (check) | 2012 |
| turner2012a_fig72 | vector | outlined or absent (check) | 2012 |
| turner2012a_fig75 | vector | text | 2012 |
| upchurch2015a_fig15 | raster | in image | 2015 |
| varricchio2007a_fig5 | raster (rendered region) | in image | 2007 |
| vila2022a_fig3 | vector | text | 2022 |
| voris2020a_fig11 | raster | in image | 2020 |
| wang2016b_fig4 | raster | in image | 2016 |
| wang2024a_fig6 | raster | in image | 2024 |
| wang2025a_fig3 | raster | in image | 2025 |
| wilson2003b_fig21 | raster (rendered region) | in image | 2003 |
| wilson2016a_fig23 | raster | in image | 2016 |
| wilson2020a_fig9 | mixed: text labels over raster | text | 2020 |
| xu2001a_fig3 | raster | in image | 2001 |
| xu2002d_fig2 | raster (rendered region) | in image | 2002 |
| xu2006d_fig3 | raster (rendered region) | in image | 2006 |
| xu2010c_fig9 | raster | in image | 2010 |
| xu2018c_fig3 | raster | in image | 2018 |
| yao2026a_fig9 | raster | in image | 2026 |
| yates2003a_fig4 | raster (rendered region) | in image | 2003 |
| yates2007a_fig8 | raster (rendered region) | in image | 2007 |
| you2009a_fig3 | raster (rendered region) | in image | 2009 |
| yu2018a_fig5 | raster | in image | 2018 |
| yu2020a_fig3 | vector | text | 2020 |
| zheng2018a_fig10 | vector | outlined or absent (check) | 2018 |
| zhou2026a_fig6 | raster | in image | 2026 |

## Not trees (22)

cau2025a_fig2, choiniere2010a_fig3, evans2015a_fig14, griffin2022a_fig3, hendrickx2025a_fig8, herne2019a_fig3, ishikawa2023a_fig10, müller2021a_fig4, nesbitt2019a_fig4, nesbitt2020a_fig19, ning2024z_fig15, novas2004a_fig2, novas2021a_fig7, o'connor2025a_fig2, ortega2010a_fig2, royo-torres2017a_fig13, sereno1994a_fig3, turner2012a_fig57, vanderreest2017a_fig16, wang2019c_fig5, xing2024b_fig3, xu2026b_fig4
