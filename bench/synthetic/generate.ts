/**
 * Generates synthetic benchmark cases: random trees rendered in several figure styles, each
 * with its gold Newick and name list, under bench/generated/.
 *
 *   node --experimental-strip-types bench/synthetic/generate.ts [--seed N] [--per-style N]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

import { formatNexus } from "../../src/core/nexus.ts";
import { SeededRandom } from "./random.ts";
import { collectTipNames, createRandomTree, formatSyntheticNewick } from "./tree.ts";
import type { FigureStyle } from "./render.ts";
import { renderFigure } from "./render.ts";

/**
 * A named style preset with its tree parameters.
 */
type StylePreset = {
    /**
     * Preset name, used in case names.
     */
    name: string;

    /**
     * Figure style.
     */
    style: FigureStyle;

    /**
     * Range of tip counts.
     */
    tips: Array<number>;

    /**
     * Chance of collapsing a node into a polytomy.
     */
    polytomyRate: number;

    /**
     * Kind of support values.
     */
    support: "bremer" | "bootstrap" | "both" | null;
};

const presets: Array<StylePreset> = [
    {
        name: "clean",
        style: { rowSpacing: 22, fontSize: 13, fontFamily: "sans-serif", italic: false, bold: false, lineWidth: 2, layout: "cladogram", supportPlacement: "none", rangeBarRate: 0, bands: false, cladeBoxes: 0, labelGap: 8, jpegQuality: 0, blurFactor: 1 },
        tips: [12, 30],
        polytomyRate: 0.15,
        support: null,
    },
    {
        name: "paper",
        style: { rowSpacing: 20, fontSize: 12, fontFamily: "serif", italic: true, bold: false, lineWidth: 1.5, layout: "cladogram", supportPlacement: "above-junction", rangeBarRate: 0, bands: false, cladeBoxes: 0, labelGap: 6, jpegQuality: 85, blurFactor: 1 },
        tips: [20, 45],
        polytomyRate: 0.2,
        support: "bootstrap",
    },
    {
        name: "timescaled",
        style: { rowSpacing: 18, fontSize: 12, fontFamily: "sans-serif", italic: true, bold: true, lineWidth: 3, layout: "phylogram", supportPlacement: "on-branch-boxed", rangeBarRate: 0.6, bands: true, cladeBoxes: 2, labelGap: 5, jpegQuality: 75, blurFactor: 1.7 },
        tips: [30, 55],
        polytomyRate: 0.25,
        support: "both",
    },
    {
        name: "dense",
        style: { rowSpacing: 14, fontSize: 9, fontFamily: "sans-serif", italic: true, bold: false, lineWidth: 1, layout: "cladogram", supportPlacement: "above-junction", rangeBarRate: 0, bands: false, cladeBoxes: 0, labelGap: 4, jpegQuality: 90, blurFactor: 1 },
        tips: [40, 70],
        polytomyRate: 0.1,
        support: "bremer",
    },
    {
        name: "touching",
        style: { rowSpacing: 20, fontSize: 13, fontFamily: "serif", italic: true, bold: true, lineWidth: 2, layout: "phylogram", supportPlacement: "on-branch-boxed", rangeBarRate: 0.3, bands: false, cladeBoxes: 1, labelGap: -1, jpegQuality: 80, blurFactor: 1.3 },
        tips: [15, 35],
        polytomyRate: 0.3,
        support: "both",
    },
];

/**
 * Reads a numeric command-line flag.
 *
 * @param name - Flag name without dashes.
 * @param fallback - Value when absent.
 * @returns The value.
 */
function readFlag(name: string, fallback: number): number
{
    const index = process.argv.indexOf(`--${name}`);

    if (index < 0 || index + 1 >= process.argv.length)
    {
        return fallback;
    }

    const value = Number(process.argv[index + 1]);

    return Number.isFinite(value) ? value : fallback;
}

const benchDir = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const casesDir = path.join(benchDir, "generated", "cases");
const imagesDir = path.join(benchDir, "generated", "images");
const seed = readFlag("seed", 1);
const perStyle = readFlag("per-style", 3);
fs.mkdirSync(casesDir, { recursive: true });
fs.mkdirSync(imagesDir, { recursive: true });

for (const preset of presets)
{
    for (let index = 0; index < perStyle; index++)
    {
        const caseSeed = seed * 1000 + presets.indexOf(preset) * 100 + index;
        const random = new SeededRandom(caseSeed);
        const tipCount = random.nextInt(preset.tips[0], preset.tips[1]);
        const tree = createRandomTree(random, tipCount, preset.polytomyRate, preset.support);
        const figure = await renderFigure(tree, preset.style, random);
        const caseName = `synthetic-${preset.name}-${String(index + 1).padStart(2, "0")}`;
        const caseDir = path.join(casesDir, caseName);
        fs.mkdirSync(caseDir, { recursive: true });
        const imageName = `${caseName}.${figure.extension}`;
        fs.writeFileSync(path.join(imagesDir, imageName), figure.bytes);
        const names = new Array<string>();
        collectTipNames(tree, names);
        fs.writeFileSync(path.join(caseDir, "names.txt"), `${names.join("\n")}\n`);
        fs.writeFileSync(path.join(caseDir, "gold.nex"), formatNexus(`${formatSyntheticNewick(tree)};`, names, caseName, `synthetic case, seed ${caseSeed}, style ${preset.name}`));
        const profile = {
            layout: "centered",
            tipsAligned: preset.style.layout === "cladogram",
            supportLabels: preset.style.supportPlacement === "none" ? "none" : preset.style.supportPlacement === "above-junction" ? "above-branch" : "boxed-on-branch",
            italic: preset.style.italic,
            bands: preset.style.bands,
            rangeBars: preset.style.rangeBarRate > 0,
            panels: 1,
        };
        fs.writeFileSync(path.join(caseDir, "case.json"), `${JSON.stringify({ image: `../../images/${imageName}`, gold: "gold.nex", names: "names.txt", source: `synthetic ${preset.name} seed ${caseSeed}`, profile }, null, 4)}\n`);
        console.log(`${caseName}: ${tipCount} tips, ${figure.width} × ${figure.height} px`);
    }
}
