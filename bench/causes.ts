/**
 * Tallies lost tip names by cause, over the documents the last benchmark runs wrote to
 * bench/out. A gold tip the extraction did not name correctly is lost at one of five steps,
 * and the step says where the work is: tracing, pairing, reading or matching.
 *
 *   npm run bench && npm run bench:holdout && npm run bench:causes
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

import type { ExtractionDocument, Tip, TreeNode } from "../src/core/types.ts";
import type { ParsedNode } from "../src/core/newick.ts";
import { extractFirstTreeFromNexus, getTipDisplayName, parseNewick } from "../src/core/newick.ts";
import { normalizeName } from "../src/core/matching.ts";

/**
 * How the tips of one figure fared.
 */
type CauseRow = {
    /**
     * Case name.
     */
    name: string;

    /**
     * Whether the figure has a time axis or background bands, the weakest class.
     */
    timeAxis: boolean;

    /**
     * Tips in the gold tree.
     */
    gold: number;

    /**
     * Tips named as in the gold tree.
     */
    correct: number;

    /**
     * Gold tips with no traced tip to carry them: fewer tips in the tree than in the gold.
     */
    untraced: number;

    /**
     * Traced tips outside the main tree.
     */
    detached: number;

    /**
     * Tips in the tree with no label row.
     */
    unpaired: number;

    /**
     * Tips whose row read as nothing, or as text no list explains.
     */
    misread: number;

    /**
     * Tips given a name that is not in the gold tree, or one another tip already has.
     */
    mismatched: number;

    /**
     * Tips beyond the gold's count.
     */
    extra: number;
};

/**
 * Collects the tip names of a parsed tree.
 *
 * @param node - Parsed node.
 * @param into - Array to add names to.
 */
function collectGoldNames(node: ParsedNode, into: Array<string>): void
{
    if (node.children.length === 0)
    {
        into.push(node.label ?? "");

        return;
    }

    for (const child of node.children)
    {
        collectGoldNames(child, into);
    }
}

/**
 * Collects the tips reachable from the document's root.
 *
 * @param document - Extraction document.
 * @returns Identifiers of the tips in the main tree.
 */
function collectTreeTips(document: ExtractionDocument): Set<string>
{
    const nodeById = new Map<string, TreeNode>();
    const tips = new Set<string>();

    for (const node of document.nodes)
    {
        nodeById.set(node.id, node);
    }

    const pending = document.root === null ? [] : [document.root];

    while (pending.length > 0)
    {
        const id = pending.pop() as string;
        const node = nodeById.get(id);

        if (node === undefined)
        {
            tips.add(id);
        }
        else
        {
            for (const child of node.children)
            {
                pending.push(child);
            }
        }
    }

    return tips;
}

/**
 * Sorts one figure's tips by what became of them.
 *
 * @param name - Case name.
 * @param document - Extraction document.
 * @param goldNames - Tip names of the gold tree.
 * @returns The tally.
 */
function tallyCase(name: string, document: ExtractionDocument, goldNames: Array<string>): CauseRow
{
    const wanted = new Map<string, number>();

    for (const goldName of goldNames)
    {
        const key = normalizeName(goldName);
        wanted.set(key, (wanted.get(key) ?? 0) + 1);
    }

    const inTree = collectTreeTips(document);
    const row: CauseRow = { name, timeAxis: document.profile.timeScaled.axis !== null || document.profile.timeScaled.bands, gold: goldNames.length, correct: 0, untraced: 0, detached: 0, unpaired: 0, misread: 0, mismatched: 0, extra: 0 };
    const pendingTips = new Array<Tip>();

    for (const tip of document.tips)
    {
        if (!inTree.has(tip.id))
        {
            row.detached++;
            continue;
        }

        const key = normalizeName(getTipDisplayName(document, tip.id).replace(/_\d+$/, ""));
        const left = wanted.get(key) ?? 0;

        if (left > 0)
        {
            wanted.set(key, left - 1);
            row.correct++;
        }
        else
        {
            pendingTips.push(tip);
        }
    }

    for (const tip of pendingTips)
    {
        if (tip.textLine === null)
        {
            row.unpaired++;
        }
        else if (tip.match !== null && tip.match.accepted)
        {
            row.mismatched++;
        }
        else
        {
            row.misread++;
        }
    }

    const traced = row.correct + pendingTips.length;
    row.untraced = Math.max(0, row.gold - traced - row.detached);
    row.extra = Math.max(0, traced - row.gold);

    return row;
}

/**
 * Formats one row of the table.
 *
 * @param label - First column.
 * @param row - The tally.
 * @returns The line.
 */
function formatRow(label: string, row: CauseRow): string
{
    const lost = row.gold - row.correct;

    return `${label.padEnd(34)}${String(row.gold).padStart(6)}${String(row.correct).padStart(8)}${String(lost).padStart(6)}${String(row.untraced).padStart(10)}${String(row.detached).padStart(10)}${String(row.unpaired).padStart(10)}${String(row.misread).padStart(9)}${String(row.mismatched).padStart(12)}${String(row.extra).padStart(7)}`;
}

/**
 * Adds one tally into another.
 *
 * @param total - Tally to add to.
 * @param row - Tally to add.
 */
function addRow(total: CauseRow, row: CauseRow): void
{
    total.gold += row.gold;
    total.correct += row.correct;
    total.untraced += row.untraced;
    total.detached += row.detached;
    total.unpaired += row.unpaired;
    total.misread += row.misread;
    total.mismatched += row.mismatched;
    total.extra += row.extra;
}

/**
 * Makes an empty tally.
 *
 * @param name - Its label.
 * @returns The tally.
 */
function createTotal(name: string): CauseRow
{
    return { name, timeAxis: false, gold: 0, correct: 0, untraced: 0, detached: 0, unpaired: 0, misread: 0, mismatched: 0, extra: 0 };
}

const benchDir = path.dirname(url.fileURLToPath(import.meta.url));
const rows = new Array<CauseRow>();

for (const root of [path.join(benchDir, "cases"), path.join(benchDir, "holdout", "cases")])
{
    for (const entry of fs.readdirSync(root).sort())
    {
        const casePath = path.join(root, entry, "case.json");
        const documentPath = path.join(benchDir, "out", entry, "document.json");

        if (!fs.existsSync(casePath) || !fs.existsSync(documentPath))
        {
            continue;
        }

        const benchCase = JSON.parse(fs.readFileSync(casePath, "utf8")) as { gold?: string };

        if (benchCase.gold === undefined)
        {
            continue;
        }

        const goldText = fs.readFileSync(path.join(root, entry, benchCase.gold), "utf8");
        const newick = extractFirstTreeFromNexus(goldText) ?? goldText;
        const goldNames = new Array<string>();
        collectGoldNames(parseNewick(newick), goldNames);
        rows.push(tallyCase(entry, JSON.parse(fs.readFileSync(documentPath, "utf8")) as ExtractionDocument, goldNames));
    }
}

console.log(`${"case".padEnd(34)}${"gold".padStart(6)}${"correct".padStart(8)}${"lost".padStart(6)}${"untraced".padStart(10)}${"detached".padStart(10)}${"unpaired".padStart(10)}${"misread".padStart(9)}${"mismatched".padStart(12)}${"extra".padStart(7)}`);
const all = createTotal("all figures");
const withAxis = createTotal("with a time axis or bands");
const without = createTotal("without one");

for (const row of rows)
{
    if (row.gold !== row.correct || row.extra > 0)
    {
        console.log(formatRow(row.name, row));
    }

    addRow(all, row);
    addRow(row.timeAxis ? withAxis : without, row);
}

console.log("");
console.log(formatRow(`${all.name} (${rows.length})`, all));
console.log(formatRow(withAxis.name, withAxis));
console.log(formatRow(without.name, without));
