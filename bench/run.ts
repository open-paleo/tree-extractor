/**
 * Runs every benchmark case and reports topology and label agreement with the gold tree.
 *
 * Each case directory holds case.json ({ "image": path, "gold": path, "names": path }), with
 * paths relative to the case directory. Images live outside git in bench/images/.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import * as tesseract from "tesseract.js";

import type { Box, CladeMark, ExtractionDocument, FigureProfile, LayoutKind, SupportLabelStyle } from "../src/core/types.ts";
import { collectConnected } from "../src/core/tree.ts";
import { formatProfile } from "../src/core/profile.ts";
import { extractTree, formatTimings } from "../src/core/pipeline.ts";
import { formatDocumentAsNewick } from "../src/core/newick.ts";
import { extractFirstTreeFromNexus, parseNewick } from "../src/core/newick.ts";
import { compareTrees } from "../src/core/compare.ts";
import { createTesseractOcr } from "../src/ocr/tesseract.ts";
import { loadImage, writeOverlay } from "../src/cli/image.ts";

type BenchCase = {
    image: string;
    gold?: string;
    names: string;
    region?: Box;
    license?: string;
    attribution?: string;
    profile?: ExpectedProfile;
};

/**
 * Profile values a case expects; only the keys given are checked.
 */
type ExpectedProfile = {
    orientation?: string;
    layout?: LayoutKind;
    tipsAligned?: boolean;
    supportLabels?: SupportLabelStyle;
    cladeMarks?: Array<CladeMark>;
    italic?: boolean;
    letterSpaced?: boolean;
    bands?: boolean;
    rangeBars?: boolean;
    calibrated?: boolean;
    panels?: number;
};

/**
 * How the measured profile compared with the expected one.
 */
type ProfileCheck = {
    checked: number;
    matched: number;
    mismatches: Array<string>;
    unmeasured: Array<string>;
};

/**
 * Compares a measured profile with a case's expectations.
 *
 * @param expected - Expected values.
 * @param profile - Measured profile.
 * @returns Counts and a description of each mismatch.
 */
function checkProfile(expected: ExpectedProfile, profile: FigureProfile): ProfileCheck
{
    const check: ProfileCheck = { checked: 0, matched: 0, mismatches: [], unmeasured: [] };

    function compare(name: string, want: unknown, got: unknown): void
    {
        if (want === undefined)
        {
            return;
        }

        check.checked++;

        if (JSON.stringify(want) === JSON.stringify(got))
        {
            check.matched++;
        }
        else
        {
            check.mismatches.push(`${name}: expected ${JSON.stringify(want)}, measured ${JSON.stringify(got)}`);
        }
    }

    compare("orientation", expected.orientation, profile.orientation);
    compare("layout", expected.layout, profile.layout);
    compare("tipsAligned", expected.tipsAligned, profile.tipAlignment.aligned);
    compare("supportLabels", expected.supportLabels, profile.supportLabels);
    compare("cladeMarks", expected.cladeMarks === undefined ? undefined : [...expected.cladeMarks].sort(), [...profile.cladeMarks].sort());
    if (profile.font.italic === null && expected.italic !== undefined)
    {
        check.unmeasured.push("italic");
    }
    else
    {
        compare("italic", expected.italic, profile.font.italic);
    }

    compare("letterSpaced", expected.letterSpaced, profile.font.letterSpaced);
    compare("bands", expected.bands, profile.timeScaled.bands);
    compare("rangeBars", expected.rangeBars, profile.timeScaled.rangeBars > 0);
    compare("calibrated", expected.calibrated, profile.timeScaled.calibration !== null);
    compare("panels", expected.panels, profile.panels.length);

    return check;
}

/**
 * Whether a value is a box with four finite numbers.
 *
 * @param value - Value from case.json.
 * @returns True for a box.
 */
function isBox(value: unknown): value is Box
{
    if (typeof value !== "object" || value === null)
    {
        return false;
    }

    const box = value as Record<string, unknown>;

    return ["x0", "y0", "x1", "y1"].every((key) => typeof box[key] === "number" && Number.isFinite(box[key]));
}

/**
 * One line of the cold-run table: a case with no gold tree.
 */
type ColdRow = {
    name: string;
    tips: number;
    inTree: number;
    matched: number;
    names: number;
    warnings: number;
    errors: number;
};

const coldRows = new Array<ColdRow>();

/**
 * Reports a case run without a gold tree: what was found, how many names were matched, and
 * what the quality checks said, so that a reader can judge it before a gold tree exists.
 *
 * @param caseName - Case name.
 * @param document - Extraction document.
 * @param names - The paper's name list.
 */
function reportColdRun(caseName: string, document: ExtractionDocument, names: Array<string>): void
{
    const connected = collectConnected(document);
    let inTree = 0;
    let matched = 0;
    const matchedNames = new Set<string>();

    for (const tip of document.tips)
    {
        if (!connected.has(tip.id))
        {
            continue;
        }

        inTree++;

        if (tip.match !== null && tip.match.accepted)
        {
            matched++;
            matchedNames.add(tip.match.name);
        }
    }

    let warnings = 0;
    let errors = 0;

    for (const issue of document.qc)
    {
        if (issue.severity === "warning")
        {
            warnings++;
        }
        else if (issue.severity === "error")
        {
            errors++;
        }
    }

    coldRows.push({ name: caseName, tips: document.tips.length, inTree, matched, names: names.length, warnings, errors });

    for (const line of formatProfile(document.profile))
    {
        console.log(`profile ${line}`);
    }

    console.log(`cold: ${inTree} tips in the tree (${document.tips.length} found), ${matched} matched names of ${names.length} listed, ${warnings} warning(s), ${errors} error(s)`);
    const unmatchedListed = names.filter((name) => !matchedNames.has(name));

    if (unmatchedListed.length > 0)
    {
        console.log(`  listed names not matched: ${unmatchedListed.join(", ")}`);
    }

    for (const issue of document.qc)
    {
        if (issue.severity !== "info")
        {
            console.log(`  ${issue.severity} ${issue.code}: ${issue.message}`);
        }
    }
}

/**
 * One line of the closing summary table.
 */
type SummaryRow = {
    /**
     * Case name.
     */
    name: string;

    /**
     * Tips found.
     */
    tips: number;

    /**
     * Gold tips.
     */
    goldTips: number;

    /**
     * Tips named correctly.
     */
    named: number;

    /**
     * Gold splits recovered.
     */
    splits: number;

    /**
     * Gold splits in total.
     */
    goldSplits: number;

    /**
     * Extra splits.
     */
    extraSplits: number;

    /**
     * Whether the tree is identical.
     */
    identical: boolean;

    /**
     * Profile features checked and matched, or null when the case expects none.
     */
    profile: ProfileCheck | null;
};

const benchDir = path.dirname(url.fileURLToPath(import.meta.url));
const outDir = path.join(benchDir, "out");
const skipOcr = process.argv.includes("--no-ocr");
const strict = process.argv.includes("--strict");
const expectedIdentical = new Set(JSON.parse(fs.readFileSync(path.join(benchDir, "expectations.json"), "utf8")).identical as Array<string>);
const filter = process.argv.find((argument) => argument.startsWith("--only=")) ?? null;
const ocr = skipOcr ? null : await createTesseractOcr(tesseract);
const knownNamesPath = path.join(benchDir, "..", "names", "known-taxa.txt");
const knownNames = fs.existsSync(knownNamesPath) ? fs.readFileSync(knownNamesPath, "utf8").split(/\r?\n/).filter((line) => line.trim().length > 0) : new Array<string>();
const caseDirs = new Array<string>();

const holdout = process.argv.includes("--holdout");
const overrides: Record<string, unknown> = {};

for (const argument of process.argv)
{
    if (argument.startsWith("--set="))
    {
        const [key, value] = argument.slice("--set=".length).split("=");
        overrides[key] = JSON.parse(value);
    }
}

const roots = holdout ? [path.join(benchDir, "holdout", "cases")] : [path.join(benchDir, "cases"), path.join(benchDir, "generated", "cases")];

for (const root of roots)
{
    if (!fs.existsSync(root))
    {
        continue;
    }

    for (const name of fs.readdirSync(root).sort())
    {
        if (filter === null || name.includes(filter.slice("--only=".length)))
        {
            caseDirs.push(path.join(root, name));
        }
    }
}

const summary = new Array<SummaryRow>();

for (const caseDir of caseDirs)
{
    const caseName = path.basename(caseDir);
    const casePath = path.join(caseDir, "case.json");

    if (!fs.existsSync(casePath))
    {
        continue;
    }

    const benchCase = JSON.parse(fs.readFileSync(casePath, "utf8")) as BenchCase;
    const imagePath = path.resolve(caseDir, benchCase.image);

    // A region must be a box; a case that describes the region in words is run whole.
    if (benchCase.region !== undefined && !isBox(benchCase.region))
    {
        console.log(`${caseName}: region is not a box (${JSON.stringify(benchCase.region)}); the whole image is analyzed`);
        benchCase.region = undefined;
    }

    if (!fs.existsSync(imagePath))
    {
        console.log(`${caseName}: image missing at ${imagePath}, skipped`);
        continue;
    }

    // An image kept inside the case directory is committed, so it must carry a license that
    // allows redistribution and the attribution that license requires.
    if (imagePath.startsWith(caseDir) && (benchCase.license === undefined || benchCase.attribution === undefined))
    {
        console.log(`${caseName}: image is inside the case directory but case.json has no license and attribution; skipped`);
        continue;
    }

    const names = new Array<string>();

    for (const line of fs.readFileSync(path.resolve(caseDir, benchCase.names), "utf8").split(/\r?\n/))
    {
        if (line.trim().length > 0)
        {
            names.push(line.trim());
        }
    }

    // A case without a gold tree is run cold: its extraction is reported, not scored.
    const goldPath = benchCase.gold === undefined ? null : path.resolve(caseDir, benchCase.gold);
    const goldText = goldPath === null || !fs.existsSync(goldPath) ? null : extractFirstTreeFromNexus(fs.readFileSync(goldPath, "utf8"));

    if (goldPath !== null && goldText === null)
    {
        console.log(`${caseName}: no tree in gold file, skipped`);
        continue;
    }

    let document: ExtractionDocument;

    try
    {
        document = await extractTree(await loadImage(imagePath), { ocr, names, knownNames, source: benchCase.image, region: benchCase.region ?? null, parameters: overrides });
    }
    catch (error)
    {
        // One case must not stop the run; a crash is a finding like any other.
        console.log(`== ${caseName}`);
        console.log(`failed: ${error instanceof Error ? error.message : String(error)}`);
        coldRows.push({ name: caseName, tips: 0, inTree: 0, matched: 0, names: names.length, warnings: 0, errors: 1 });
        continue;
    }

    const newick = formatDocumentAsNewick(document);
    const caseOut = path.join(outDir, caseName);
    fs.mkdirSync(caseOut, { recursive: true });
    fs.writeFileSync(path.join(caseOut, "document.json"), JSON.stringify(document, null, 2));
    fs.writeFileSync(path.join(caseOut, "tree.nwk"), `${newick ?? ""}\n`);
    await writeOverlay(imagePath, document, path.join(caseOut, "overlay.png"));

    console.log(`== ${caseName}`);
    console.log(`timings: ${formatTimings(document.timings)}`);

    if (newick === null)
    {
        console.log("no tree extracted");
        continue;
    }

    if (goldText === null)
    {
        reportColdRun(caseName, document, names);
        continue;
    }

    let goldTree;

    try
    {
        goldTree = parseNewick(goldText);
    }
    catch (error)
    {
        console.log(`gold tree does not parse: ${error instanceof Error ? error.message : String(error)}`);
        coldRows.push({ name: caseName, tips: document.tips.length, inTree: 0, matched: 0, names: names.length, warnings: 0, errors: 1 });
        continue;
    }

    const comparison = compareTrees(goldTree, parseNewick(newick));
    const profileCheck = benchCase.profile === undefined ? null : checkProfile(benchCase.profile, document.profile);
    summary.push({
        name: caseName,
        tips: document.tips.length,
        goldTips: comparison.sharedLeaves.length + comparison.missingLeaves.length,
        named: comparison.sharedLeaves.length,
        splits: comparison.matchedSplits,
        goldSplits: comparison.referenceSplits,
        extraSplits: comparison.extraSplits.length,
        identical: comparison.identical,
        profile: profileCheck,
    });

    for (const line of formatProfile(document.profile))
    {
        console.log(`profile ${line}`);
    }

    if (profileCheck !== null)
    {
        for (const mismatch of profileCheck.mismatches)
        {
            console.log(`  profile mismatch, ${mismatch}`);
        }

        for (const name of profileCheck.unmeasured)
        {
            console.log(`  profile not measured: ${name}`);
        }
    }

    console.log(`tips: ${document.tips.length} found, ${comparison.sharedLeaves.length} named correctly, ${comparison.missingLeaves.length} gold names missing, ${comparison.extraLeaves.length} extra`);
    console.log(`splits: ${comparison.matchedSplits}/${comparison.referenceSplits} gold splits recovered, ${comparison.extraSplits.length} extra; identical=${comparison.identical}`);

    if (comparison.missingLeaves.length > 0)
    {
        console.log(`  missing names: ${comparison.missingLeaves.join(", ")}`);
    }

    if (comparison.extraLeaves.length > 0)
    {
        console.log(`  extra names: ${comparison.extraLeaves.join(", ")}`);
    }

    for (const split of comparison.missingSplits.slice(0, 10))
    {
        console.log(`  missing split: {${split.join(", ")}}`);
    }

    for (const split of comparison.extraSplits.slice(0, 10))
    {
        console.log(`  extra split: {${split.join(", ")}}`);
    }

    for (const issue of document.qc)
    {
        if (issue.severity !== "info")
        {
            console.log(`  ${issue.severity} ${issue.code}: ${issue.message}`);
        }
    }
}

if (ocr !== null)
{
    await ocr.terminate();
}

if (coldRows.length > 0)
{
    console.log("");
    console.log("cold run (no gold tree)".padEnd(32), "in tree".padStart(9), "found".padStart(7), "matched".padStart(9), "warn".padStart(6), "error".padStart(6));

    for (const row of coldRows)
    {
        console.log(row.name.padEnd(32), `${row.inTree}`.padStart(9), `${row.tips}`.padStart(7), `${row.matched}/${row.names}`.padStart(9), `${row.warnings}`.padStart(6), `${row.errors}`.padStart(6));
    }
}

console.log("");
console.log("case".padEnd(32), "tips".padStart(9), "named".padStart(9), "splits".padStart(11), "extra".padStart(6), "profile".padStart(8), " identical");
const regressions = new Array<string>();

for (const row of summary)
{
    const expected = expectedIdentical.has(row.name);
    let verdict = row.identical ? " yes" : " no";

    if (expected && !row.identical)
    {
        verdict = " no  <-- expected identical";
        regressions.push(row.name);
    }
    else if (!expected && row.identical)
    {
        verdict = " yes (add to expectations.json)";
    }

    console.log(
        row.name.padEnd(32),
        `${row.tips}/${row.goldTips}`.padStart(9),
        `${row.named}/${row.goldTips}`.padStart(9),
        `${row.splits}/${row.goldSplits}`.padStart(11),
        `${row.extraSplits}`.padStart(6),
        (row.profile === null ? "-" : `${row.profile.matched}/${row.profile.checked}`).padStart(8),
        verdict,
    );
}

if (strict && regressions.length > 0)
{
    console.log(`\n${regressions.length} case(s) expected identical are not: ${regressions.join(", ")}`);
    process.exitCode = 1;
}
