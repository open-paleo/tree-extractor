#!/usr/bin/env -S node --experimental-strip-types
/**
 * Command-line entry point.
 *
 *   tree-extractor extract <image> [--names <file>] [--known-names <file>|--no-known-names] [--out <dir>] [--no-ocr] [--overlay] [--no-lengths] [--profile key=value,...]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import * as tesseract from "tesseract.js";

import type { Box, LayoutKind, ProfileOverrides, SupportLabelStyle } from "../core/types.ts";
import { extractTree, formatTimings } from "../core/pipeline.ts";
import { formatProfile } from "../core/profile.ts";
import { formatDocumentAsNewick, getTipDisplayName } from "../core/newick.ts";
import { formatNexus } from "../core/nexus.ts";
import { createTesseractOcr } from "../ocr/tesseract.ts";
import { loadImage, writeOverlay } from "./image.ts";

type Arguments = {
    command: string | null;
    positional: Array<string>;
    flags: Map<string, string | true>;
};

/**
 * Splits argv into a command, positional arguments and --flags.
 *
 * @param argv - Arguments after the script name.
 * @returns Parsed arguments.
 */
function parseArguments(argv: Array<string>): Arguments
{
    const flags = new Map<string, string | true>();
    const positional = new Array<string>();

    for (let index = 0; index < argv.length; index++)
    {
        const argument = argv[index];

        if (argument.startsWith("--"))
        {
            const name = argument.slice(2);
            const next = argv[index + 1];

            if (next !== undefined && !next.startsWith("--") && name !== "no-ocr" && name !== "overlay" && name !== "help" && name !== "no-lengths" && name !== "no-known-names")
            {
                flags.set(name, next);
                index++;
            }
            else
            {
                flags.set(name, true);
            }
        }
        else
        {
            positional.push(argument);
        }
    }

    return { command: positional.shift() ?? null, positional, flags };
}

/**
 * Prints usage.
 */
function printUsage(): void
{
    console.log([
        "Usage: tree-extractor extract <image> [options]",
        "",
        "Options:",
        "  --names <file>   Text file with one taxon name per line to match labels against",
        "  --out <dir>      Output directory (default: current directory)",
        "  --crop x,y,w,h   Analyze only this region of the image (pixels)",
        "  --known-names <file>  Known taxa to fall back on when a label is not in --names",
        "                   (default: names/known-taxa.txt shipped with the tool; --no-known-names skips it)",
        "  --no-ocr         Trace the tree but do not read labels",
        "  --no-lengths     Leave branch lengths out of the Newick even when a time axis was read",
        "  --profile k=v    Fix profile values instead of measuring them, comma separated:",
        "                   layout, supportLabels, tipsAligned, italic, widenText, condensing",
        "  --overlay        Also write <name>.overlay.png showing what was detected",
    ].join("\n"));
}

/**
 * Reads a name list file: one name per line, blank lines ignored.
 *
 * @param filePath - Path to the file.
 * @returns The names.
 */
function readNameList(filePath: string): Array<string>
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
 * Reads the known taxa: the --known-names file, or the list shipped with the tool unless
 * --no-known-names was given.
 *
 * @param parsed - Parsed arguments.
 * @returns Known names, possibly empty.
 */
function readKnownNames(parsed: Arguments): Array<string>
{
    if (parsed.flags.has("no-known-names"))
    {
        return [];
    }

    const flag = parsed.flags.get("known-names");

    if (typeof flag === "string")
    {
        return readNameList(flag);
    }

    const bundled = url.fileURLToPath(new URL("../../names/known-taxa.txt", import.meta.url));

    return fs.existsSync(bundled) ? readNameList(bundled) : [];
}

/**
 * Parses the --profile flag: comma-separated key=value pairs.
 *
 * @param text - Flag value.
 * @returns Profile overrides.
 */
function parseProfileOverrides(text: string): ProfileOverrides
{
    const overrides: ProfileOverrides = {};

    for (const pair of text.split(","))
    {
        const [key, value] = pair.split("=");

        if (value === undefined)
        {
            throw new Error(`--profile expects key=value pairs, got "${pair}"`);
        }

        switch (key)
        {
            case "layout":
                overrides.layout = value as LayoutKind;
                break;
            case "supportLabels":
                overrides.supportLabels = value as SupportLabelStyle;
                break;
            case "tipsAligned":
                overrides.tipsAligned = value === "true";
                break;
            case "italic":
                overrides.italic = value === "true";
                break;
            case "widenText":
                overrides.widenText = value === "true";
                break;
            case "condensing":
                overrides.condensing = Number(value);
                break;
            default:
                throw new Error(`--profile does not know "${key}"`);
        }
    }

    return overrides;
}

/**
 * Parses a crop flag of the form x,y,w,h.
 *
 * @param text - Flag value.
 * @returns The region.
 */
function parseCrop(text: string): Box
{
    const parts = text.split(",");

    if (parts.length !== 4)
    {
        throw new Error(`--crop expects x,y,w,h, got "${text}"`);
    }

    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const width = Number(parts[2]);
    const height = Number(parts[3]);

    return { x0: x, y0: y, x1: x + width, y1: y + height };
}

/**
 * Runs the extract command.
 *
 * @param parsed - Parsed arguments.
 * @returns Process exit code.
 */
async function runExtract(parsed: Arguments): Promise<number>
{
    const imagePath = parsed.positional[0];

    if (imagePath === undefined)
    {
        printUsage();

        return 2;
    }

    const namesFlag = parsed.flags.get("names");
    const names = typeof namesFlag === "string" ? readNameList(namesFlag) : new Array<string>();
    const knownNames = readKnownNames(parsed);

    const outFlag = parsed.flags.get("out");
    const outDir = typeof outFlag === "string" ? outFlag : process.cwd();
    fs.mkdirSync(outDir, { recursive: true });

    const image = await loadImage(imagePath);
    const cropFlag = parsed.flags.get("crop");
    const region = typeof cropFlag === "string" ? parseCrop(cropFlag) : null;
    const ocr = parsed.flags.has("no-ocr") ? null : await createTesseractOcr(tesseract);
    const profileFlag = parsed.flags.get("profile");
    const profileOverrides = typeof profileFlag === "string" ? parseProfileOverrides(profileFlag) : {};
    const document = await extractTree(image, { ocr, names, knownNames, source: path.basename(imagePath), region, parameters: { profileOverrides } });

    if (ocr !== null)
    {
        await ocr.terminate();
    }

    const stem = path.join(outDir, path.basename(imagePath, path.extname(imagePath)));
    fs.writeFileSync(`${stem}.json`, JSON.stringify(document, null, 2));
    const newick = formatDocumentAsNewick(document, { branchLengths: !parsed.flags.has("no-lengths") });

    if (newick !== null)
    {
        fs.writeFileSync(`${stem}.nwk`, `${newick}\n`);
        const taxa = new Array<string>();

        for (const tip of document.tips)
        {
            if (tip.parent !== null)
            {
                taxa.push(getTipDisplayName(document, tip.id));
            }
        }

        fs.writeFileSync(`${stem}.nex`, formatNexus(newick, taxa, "extracted", `Extracted from ${path.basename(imagePath)} by tree-extractor`));
    }

    if (parsed.flags.has("overlay"))
    {
        await writeOverlay(imagePath, document, `${stem}.overlay.png`);
    }

    for (const issue of document.qc)
    {
        console.log(`${issue.severity.padEnd(7)} ${issue.code}: ${issue.message}`);
    }

    for (const line of formatProfile(document.profile))
    {
        console.log(`profile ${line}`);
    }

    console.log(`timings: ${formatTimings(document.timings)}`);
    console.log(newick ?? "(no tree)");

    for (const issue of document.qc)
    {
        if (issue.severity === "error")
        {
            return 1;
        }
    }

    return 0;
}

const parsed = parseArguments(process.argv.slice(2));

if (parsed.command === "extract")
{
    process.exitCode = await runExtract(parsed);
}
else
{
    printUsage();
    process.exitCode = parsed.flags.has("help") ? 0 : 2;
}
