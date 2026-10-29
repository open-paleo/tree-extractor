/**
 * Batch run over a corpus of figures without gold trees: one row per figure in a manifest,
 * each run cold and reported, never scored. The point is the statistics across the set: how
 * many figures of each kind yield a tree, how many of their listed names are matched, what the
 * quality checks complain of most, and where the crashes are.
 *
 *   node --experimental-strip-types bench/batch.ts --manifest=<file.json> [--root=<dir>] [--out=<dir>]
 *       [--only=<substring>] [--limit=<n>] [--all] [--no-ocr] [--overlay] [--set=key=value]
 *
 * The manifest is a JSON array of rows:
 *   { "id": "paper_fig", "image": "path", "names": "path" | null, "region": Box | null,
 *     "layout": "rectangular" | "slanted" | "vertical" | "circular" | ..., "flags": [...],
 *     "is_tree": true }
 * Paths are relative to --root, or to the manifest's directory. Rows with is_tree false are
 * skipped unless --all is given. Results go to <out>/results.jsonl (one JSON
 * object per figure) and <out>/<id>/ (document, Newick, optional overlay), and a summary by
 * layout class is printed at the end.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { createRequire } from "node:module";

import type { Box, ExtractionDocument } from "../src/core/types.ts";
import { extractTree } from "../src/core/pipeline.ts";
import { formatDocumentAsNewick } from "../src/core/newick.ts";
import { collectConnected } from "../src/core/tree.ts";
import { loadImage, writeOverlay } from "../src/cli/image.ts";
import { createTesseractOcr } from "../src/ocr/tesseract.ts";

const require = createRequire(import.meta.url);
const tesseract = require("tesseract.js");

/**
 * One row of the manifest.
 */
type ManifestRow = {
    /**
     * Figure identifier, used as the output directory name.
     */
    id: string;

    /**
     * Image path, relative to the manifest.
     */
    image: string;

    /**
     * Name list path, relative to the manifest, or null.
     */
    names?: string | null;

    /**
     * Region of the figure to analyze, or null for the whole image.
     */
    region?: Box | null;

    /**
     * Layout class from the census.
     */
    layout?: string;

    /**
     * Feature flags from the census.
     */
    flags?: Array<string>;

    /**
     * False when the census found the located image not to be a tree.
     */
    is_tree?: boolean;
};

/**
 * What one figure's run produced.
 */
type BatchResult = {
    /**
     * Figure identifier.
     */
    id: string;

    /**
     * Layout class from the manifest, or "unknown".
     */
    layout: string;

    /**
     * Feature flags from the manifest.
     */
    features: Array<string>;

    /**
     * Tips found in all.
     */
    tips: number;

    /**
     * Tips in the main tree.
     */
    inTree: number;

    /**
     * Tips in the main tree with an accepted name.
     */
    named: number;

    /**
     * Distinct listed names matched by tips in the main tree.
     */
    matched: number;

    /**
     * Names listed for the figure.
     */
    listed: number;

    /**
     * Orientation the pipeline decided.
     */
    orientation: string;

    /**
     * Layout the pipeline measured.
     */
    measuredLayout: string;

    /**
     * Quality-check codes with counts.
     */
    codes: Record<string, number>;

    /**
     * Warnings and errors among the quality checks.
     */
    warnings: number;

    /**
     * Milliseconds for the whole extraction.
     */
    milliseconds: number;

    /**
     * Crash message, or null.
     */
    crash: string | null;
};

/**
 * Reads a name list file: one name per line, blank lines ignored.
 *
 * @param filePath - Path to the list.
 * @returns The names.
 */
function readNames(filePath: string): Array<string>
{
    const names = new Array<string>();

    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/))
    {
        if (line.trim().length > 0)
        {
            names.push(line.trim());
        }
    }

    return names;
}

/**
 * Resolves a name list path, falling back from a held-out case directory to the bench case
 * directory of the same name when the case has moved.
 *
 * @param filePath - Path as the manifest gives it.
 * @returns A path that exists, or the original when neither does.
 */
function findNamesFile(filePath: string): string
{
    if (fs.existsSync(filePath))
    {
        return filePath;
    }

    const moved = filePath.replace(`${path.sep}holdout${path.sep}cases${path.sep}`, `${path.sep}cases${path.sep}`);

    return fs.existsSync(moved) ? moved : filePath;
}

/**
 * Summarizes a document into a result row.
 *
 * @param row - Manifest row.
 * @param document - Extraction document.
 * @param listed - Names listed for the figure.
 * @param milliseconds - Time the extraction took.
 * @returns The result.
 */
function summarize(row: ManifestRow, document: ExtractionDocument, listed: number, milliseconds: number): BatchResult
{
    const connected = collectConnected(document);
    const matchedNames = new Set<string>();
    let inTree = 0;
    let named = 0;

    for (const tip of document.tips)
    {
        if (!connected.has(tip.id))
        {
            continue;
        }

        inTree++;

        if (tip.match !== null && tip.match.accepted)
        {
            named++;
            matchedNames.add(tip.match.name);
        }
    }

    const codes: Record<string, number> = {};
    let warnings = 0;

    for (const issue of document.qc)
    {
        codes[issue.code] = (codes[issue.code] ?? 0) + 1;

        if (issue.severity !== "info")
        {
            warnings++;
        }
    }

    return {
        id: row.id,
        layout: row.layout ?? "unknown",
        features: row.flags ?? [],
        tips: document.tips.length,
        inTree,
        named,
        matched: matchedNames.size,
        listed,
        orientation: document.profile.orientation,
        measuredLayout: document.profile.layout,
        codes,
        warnings,
        milliseconds,
        crash: null,
    };
}

/**
 * A line of the summary by layout class.
 */
type ClassSummary = {
    /**
     * Layout class.
     */
    layout: string;

    /**
     * Figures of the class.
     */
    figures: number;

    /**
     * Figures that yielded a tree of three tips or more.
     */
    withTree: number;

    /**
     * Figures that crashed.
     */
    crashes: number;

    /**
     * Mean tips in the main tree.
     */
    meanTips: number;

    /**
     * Figures with a name list.
     */
    withNames: number;

    /**
     * Share of listed names matched, over the figures with a name list.
     */
    matchedShare: number;

    /**
     * Mean seconds per figure.
     */
    meanSeconds: number;
};

/**
 * Summarizes results by layout class.
 *
 * @param results - All results.
 * @returns One line per class, largest first.
 */
function summarizeByClass(results: Array<BatchResult>): Array<ClassSummary>
{
    const byClass = new Map<string, Array<BatchResult>>();

    for (const result of results)
    {
        const group = byClass.get(result.layout) ?? [];
        group.push(result);
        byClass.set(result.layout, group);
    }

    const lines = new Array<ClassSummary>();

    for (const [layout, group] of byClass)
    {
        let withTree = 0;
        let crashes = 0;
        let tips = 0;
        let withNames = 0;
        let matched = 0;
        let listed = 0;
        let milliseconds = 0;

        for (const result of group)
        {
            withTree += result.inTree >= 3 ? 1 : 0;
            crashes += result.crash === null ? 0 : 1;
            tips += result.inTree;
            milliseconds += result.milliseconds;

            if (result.listed > 0)
            {
                withNames++;
                matched += result.matched;
                listed += result.listed;
            }
        }

        lines.push({
            layout,
            figures: group.length,
            withTree,
            crashes,
            meanTips: tips / group.length,
            withNames,
            matchedShare: listed === 0 ? 0 : matched / listed,
            meanSeconds: milliseconds / group.length / 1000,
        });
    }

    function compareFigures(left: ClassSummary, right: ClassSummary): number
    {
        return right.figures - left.figures;
    }

    lines.sort(compareFigures);

    return lines;
}

/**
 * Reads a flag of the form --name=value.
 *
 * @param name - Flag name.
 * @returns The value, or null.
 */
function readFlag(name: string): string | null
{
    const prefix = `--${name}=`;

    for (const argument of process.argv)
    {
        if (argument.startsWith(prefix))
        {
            return argument.slice(prefix.length);
        }
    }

    return null;
}

const manifestPath = readFlag("manifest");

if (manifestPath === null)
{
    console.error("usage: batch.ts --manifest=<file.json> [--out=<dir>] [--only=<substring>] [--limit=<n>] [--no-ocr] [--overlay] [--set=key=value]");
    process.exit(2);
}

const manifestDir = readFlag("root") === null ? path.dirname(path.resolve(manifestPath)) : path.resolve(readFlag("root") as string);
const rows = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Array<ManifestRow>;
const benchDir = path.dirname(url.fileURLToPath(import.meta.url));
const outDir = readFlag("out") ?? path.join(benchDir, "out", "batch");
const only = readFlag("only");
const limit = readFlag("limit") === null ? Infinity : Number(readFlag("limit"));
const skipOcr = process.argv.includes("--no-ocr");
const overlay = process.argv.includes("--overlay");
const includeAll = process.argv.includes("--all");
const overrides: Record<string, unknown> = {};

for (const argument of process.argv)
{
    if (argument.startsWith("--set="))
    {
        const [key, value] = argument.slice("--set=".length).split("=");
        overrides[key] = JSON.parse(value);
    }
}

const knownNamesPath = path.join(benchDir, "..", "names", "known-taxa.txt");
const knownNames = fs.existsSync(knownNamesPath) ? readNames(knownNamesPath) : new Array<string>();
const ocr = skipOcr ? null : await createTesseractOcr(tesseract);
fs.mkdirSync(outDir, { recursive: true });
const resultsPath = path.join(outDir, "results.jsonl");
fs.writeFileSync(resultsPath, "");
const results = new Array<BatchResult>();
let count = 0;

for (const row of rows)
{
    if ((only !== null && !row.id.includes(only)) || (row.is_tree === false && !includeAll))
    {
        continue;
    }

    if (count >= limit)
    {
        break;
    }

    count++;
    const imagePath = path.resolve(manifestDir, row.image);
    const names = row.names === undefined || row.names === null ? new Array<string>() : readNames(findNamesFile(path.resolve(manifestDir, row.names)));
    const started = performance.now();
    let result: BatchResult;

    try
    {
        const document = await extractTree(await loadImage(imagePath), { ocr, names, knownNames, source: row.image, region: row.region ?? null, parameters: overrides });
        result = summarize(row, document, names.length, Math.round(performance.now() - started));
        const figureOut = path.join(outDir, row.id);
        fs.mkdirSync(figureOut, { recursive: true });
        fs.writeFileSync(path.join(figureOut, "document.json"), JSON.stringify(document));
        const newick = formatDocumentAsNewick(document);

        if (newick !== null)
        {
            fs.writeFileSync(path.join(figureOut, "tree.nwk"), `${newick}\n`);
        }

        if (overlay)
        {
            await writeOverlay(imagePath, document, path.join(figureOut, "overlay.png"));
        }
    }
    catch (error)
    {
        result = {
            id: row.id,
            layout: row.layout ?? "unknown",
            features: row.flags ?? [],
            tips: 0,
            inTree: 0,
            named: 0,
            matched: 0,
            listed: names.length,
            orientation: "unknown",
            measuredLayout: "unknown",
            codes: {},
            warnings: 0,
            milliseconds: Math.round(performance.now() - started),
            crash: error instanceof Error ? error.message : String(error),
        };
    }

    results.push(result);
    fs.appendFileSync(resultsPath, `${JSON.stringify(result)}\n`);
    const namesText = result.listed > 0 ? `${result.matched}/${result.listed} names` : "no names";
    console.log(`${result.id.padEnd(36)} ${result.layout.padEnd(12)} tips ${String(result.inTree).padStart(3)}/${String(result.tips).padEnd(3)} ${namesText.padEnd(14)} ${result.orientation.padEnd(11)} ${(result.milliseconds / 1000).toFixed(1).padStart(6)} s${result.crash === null ? "" : `  CRASH ${result.crash}`}`);
}

if (ocr !== null)
{
    await ocr.terminate();
}

console.log("");
console.log("class".padEnd(14), "figures".padStart(8), "tree".padStart(6), "crash".padStart(6), "tips".padStart(7), "names".padStart(6), "matched".padStart(8), "s/fig".padStart(6));

for (const line of summarizeByClass(results))
{
    console.log(line.layout.padEnd(14), `${line.figures}`.padStart(8), `${line.withTree}`.padStart(6), `${line.crashes}`.padStart(6), line.meanTips.toFixed(1).padStart(7), `${line.withNames}`.padStart(6), `${Math.round(100 * line.matchedShare)}%`.padStart(8), line.meanSeconds.toFixed(1).padStart(6));
}

const codeTotals = new Map<string, number>();

for (const result of results)
{
    for (const [code, number] of Object.entries(result.codes))
    {
        codeTotals.set(code, (codeTotals.get(code) ?? 0) + number);
    }
}

const codeLines = [...codeTotals.entries()];

function compareCounts(left: [string, number], right: [string, number]): number
{
    return right[1] - left[1];
}

codeLines.sort(compareCounts);
console.log("");
console.log("quality checks:", codeLines.slice(0, 12).map(([code, number]) => `${code} ${number}`).join(", "));
console.log(`results in ${resultsPath}`);
