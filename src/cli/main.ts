#!/usr/bin/env -S node --experimental-strip-types
/**
 * Command-line entry point.
 *
 *   tree-extractor extract <image> [--names <file>] [--known-names <file>|--no-known-names] [--known-clades <file>] [--out <dir>] [--no-ocr] [--overlay] [--no-lengths] [--no-rotation] [--profile key=value,...]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import * as tesseract from "tesseract.js";

import type { Box, LayoutKind, ProfileOverrides, SupportLabelStyle } from "../core/types.ts";
import { extractTree, formatTimings } from "../core/pipeline.ts";
import { formatProfile } from "../core/profile.ts";
import { formatDocumentAsNewick, getTipDisplayName } from "../core/newick.ts";
import { renderTreeSvg } from "../core/render.ts";
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

            if (next !== undefined && !next.startsWith("--") && name !== "no-ocr" && name !== "overlay" && name !== "help" && name !== "no-lengths" && name !== "no-known-names" && name !== "no-rotation")
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
        "Usage: tree-extractor extract <image or folder> [options]",
        "",
        "A folder is read image by image (.png, .jpg), each with the name list of its own name",
        "(figure.txt beside figure.png), else --names, else names.txt in the folder, and one",
        "line is printed per figure.",
        "",
        "Options:",
        "  --names <file>   Text file with one taxon name per line to match labels against",
        "  --out <dir>      Output directory (default: current directory)",
        "  --crop x,y,w,h   Analyze only this region of the image (pixels)",
        "  --known-names <file>  Known taxa to fall back on when a label is not in --names",
        "                   (default: names/known-taxa.txt shipped with the tool; --no-known-names skips it)",
        "  --known-clades <file>  Known clades, for mending the spelling of clade names",
        "                   (default: names/known-clades.txt shipped with the tool; --no-known-names skips it too)",
        "  --no-ocr         Trace the tree but do not read labels",
        "  --no-lengths     Leave branch lengths out of the Newick even when a time axis was read",
        "  --no-rotation    Take the figure as drawn instead of turning a tree on its side root-left",
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
 * Reads the known clades: the list named by --known-clades, or the one shipped with the tool;
 * none with --no-known-names.
 *
 * @param parsed - Parsed arguments.
 * @returns The clade names, possibly empty.
 */
function readKnownClades(parsed: Arguments): Array<string>
{
    if (parsed.flags.has("no-known-names"))
    {
        return [];
    }

    const flag = parsed.flags.get("known-clades");

    if (typeof flag === "string")
    {
        return readNameList(flag);
    }

    const bundled = url.fileURLToPath(new URL("../../names/known-clades.txt", import.meta.url));

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
 * What one extraction needs beyond its image.
 */
type ExtractJob = {
    /**
     * Taxon names to match labels against.
     */
    names: Array<string>;

    /**
     * Known taxa to fall back on.
     */
    knownNames: Array<string>;

    /**
     * Known clades, possibly empty.
     */
    knownClades: Array<string>;

    /**
     * Where the outputs go.
     */
    outDir: string;

    /**
     * Region of the image to analyze, or null for all of it.
     */
    region: Box | null;

    /**
     * OCR engine, or null to skip reading labels.
     */
    ocr: Awaited<ReturnType<typeof createTesseractOcr>> | null;

    /**
     * Profile values fixed by the user.
     */
    profileOverrides: ProfileOverrides;

    /**
     * Whether to turn a figure drawn on its side.
     */
    rotation: "auto" | "none";

    /**
     * Whether to write branch lengths.
     */
    lengths: boolean;

    /**
     * Whether to write the overlay image.
     */
    overlay: boolean;

    /**
     * Whether to print the quality checks, profile and tree; a folder run prints one line per
     * figure instead.
     */
    verbose: boolean;
};

/**
 * Extracts one figure and writes its outputs.
 *
 * @param imagePath - The figure.
 * @param job - Everything else.
 * @returns Number of error-level quality checks.
 */
async function extractOne(imagePath: string, job: ExtractJob): Promise<number>
{
    const image = await loadImage(imagePath);
    const document = await extractTree(image, { ocr: job.ocr, names: job.names, knownNames: job.knownNames, knownClades: job.knownClades, source: path.basename(imagePath), region: job.region, parameters: { profileOverrides: job.profileOverrides, rotation: job.rotation } });
    const stem = path.join(job.outDir, path.basename(imagePath, path.extname(imagePath)));
    fs.writeFileSync(`${stem}.json`, JSON.stringify(document, null, 2));
    const newick = formatDocumentAsNewick(document, { branchLengths: job.lengths });

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
        const svg = renderTreeSvg(document, { branchLengths: job.lengths });

        if (svg !== null)
        {
            fs.writeFileSync(`${stem}.svg`, `${svg}\n`);
        }
    }

    if (job.overlay)
    {
        await writeOverlay(imagePath, document, `${stem}.overlay.png`);
    }

    let errors = 0;
    let warnings = 0;

    for (const issue of document.qc)
    {
        errors += issue.severity === "error" ? 1 : 0;
        warnings += issue.severity === "warning" ? 1 : 0;

        if (job.verbose)
        {
            console.log(`${issue.severity.padEnd(7)} ${issue.code}: ${issue.message}`);
        }
    }

    if (job.verbose)
    {
        for (const line of formatProfile(document.profile))
        {
            console.log(`profile ${line}`);
        }

        console.log(`timings: ${formatTimings(document.timings)}`);
        console.log(newick ?? "(no tree)");
    }
    else
    {
        let inTree = 0;
        let named = 0;

        for (const tip of document.tips)
        {
            if (tip.parent !== null)
            {
                inTree++;
                named += tip.match !== null && tip.match.accepted ? 1 : 0;
            }
        }

        console.log(`${path.basename(imagePath).padEnd(40)} ${String(inTree).padStart(3)} tips ${String(named).padStart(3)} named ${String(warnings).padStart(3)} warning(s) ${String(errors).padStart(2)} error(s)`);
    }

    return errors;
}

/**
 * Lists the images in a folder, sorted by name.
 *
 * @param directory - The folder.
 * @returns Image paths.
 */
function listImages(directory: string): Array<string>
{
    const images = new Array<string>();

    for (const name of fs.readdirSync(directory).sort())
    {
        const extension = path.extname(name).toLowerCase();

        if (extension === ".png" || extension === ".jpg" || extension === ".jpeg")
        {
            images.push(path.join(directory, name));
        }
    }

    return images;
}

/**
 * Finds the name list for a figure in a folder: a text file of the figure's own name beside
 * it, else the --names file, else names.txt in the folder.
 *
 * @param imagePath - The figure.
 * @param shared - Names from --names, if any.
 * @returns The names.
 */
function findNamesForImage(imagePath: string, shared: Array<string> | null): Array<string>
{
    const own = path.join(path.dirname(imagePath), `${path.basename(imagePath, path.extname(imagePath))}.txt`);

    if (fs.existsSync(own))
    {
        return readNameList(own);
    }

    if (shared !== null)
    {
        return shared;
    }

    const common = path.join(path.dirname(imagePath), "names.txt");

    return fs.existsSync(common) ? readNameList(common) : [];
}

/**
 * Runs the extract command on one image or on every image in a folder.
 *
 * @param parsed - Parsed arguments.
 * @returns Process exit code.
 */
async function runExtract(parsed: Arguments): Promise<number>
{
    const target = parsed.positional[0];

    if (target === undefined)
    {
        printUsage();

        return 2;
    }

    const namesFlag = parsed.flags.get("names");
    const sharedNames = typeof namesFlag === "string" ? readNameList(namesFlag) : null;
    const knownNames = readKnownNames(parsed);
    const knownClades = readKnownClades(parsed);
    const outFlag = parsed.flags.get("out");
    const outDir = typeof outFlag === "string" ? outFlag : process.cwd();
    fs.mkdirSync(outDir, { recursive: true });
    const cropFlag = parsed.flags.get("crop");
    const region = typeof cropFlag === "string" ? parseCrop(cropFlag) : null;
    const ocr = parsed.flags.has("no-ocr") ? null : await createTesseractOcr(tesseract);
    const profileFlag = parsed.flags.get("profile");
    const profileOverrides = typeof profileFlag === "string" ? parseProfileOverrides(profileFlag) : {};
    const folder = fs.statSync(target).isDirectory();
    const job: ExtractJob = {
        names: sharedNames ?? [],
        knownNames,
        knownClades,
        outDir,
        region,
        ocr,
        profileOverrides,
        rotation: parsed.flags.has("no-rotation") ? "none" : "auto",
        lengths: !parsed.flags.has("no-lengths"),
        overlay: parsed.flags.has("overlay"),
        verbose: !folder,
    };
    let errors = 0;

    try
    {
        if (!folder)
        {
            try
            {
                errors = await extractOne(target, job);
            }
            catch (error)
            {
                console.error(error instanceof Error ? error.message : String(error));
                errors = 1;
            }
        }
        else
        {
            const images = listImages(target);

            if (images.length === 0)
            {
                console.log(`no .png or .jpg images in ${target}`);

                return 2;
            }

            for (const imagePath of images)
            {
                try
                {
                    errors += await extractOne(imagePath, { ...job, names: findNamesForImage(imagePath, sharedNames) });
                }
                catch (error)
                {
                    errors++;
                    console.log(`${path.basename(imagePath).padEnd(40)} failed: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }
    }
    finally
    {
        if (ocr !== null)
        {
            await ocr.terminate();
        }
    }

    return errors > 0 ? 1 : 0;
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
