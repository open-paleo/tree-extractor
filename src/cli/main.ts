#!/usr/bin/env -S node --experimental-strip-types
/**
 * Command-line entry point.
 *
 *   tree-extractor extract <image> [--names <file>] [--out <dir>] [--no-ocr] [--overlay]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as tesseract from "tesseract.js";

import { extractTree, formatTimings } from "../core/pipeline.ts";
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

            if (next !== undefined && !next.startsWith("--") && !["no-ocr", "overlay", "help"].includes(name))
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
        "  --no-ocr         Trace the tree but do not read labels",
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

    const outFlag = parsed.flags.get("out");
    const outDir = typeof outFlag === "string" ? outFlag : process.cwd();
    fs.mkdirSync(outDir, { recursive: true });

    const image = await loadImage(imagePath);
    const ocr = parsed.flags.has("no-ocr") ? null : await createTesseractOcr(tesseract);
    const document = await extractTree(image, { ocr, names, source: path.basename(imagePath) });

    if (ocr !== null)
    {
        await ocr.terminate();
    }

    const stem = path.join(outDir, path.basename(imagePath, path.extname(imagePath)));
    fs.writeFileSync(`${stem}.json`, JSON.stringify(document, null, 2));
    const newick = formatDocumentAsNewick(document);

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
