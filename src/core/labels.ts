/**
 * Assigns detected text lines to tips and nodes, reads them with OCR and matches tip labels
 * against a name list.
 */

import type { ExtractionDocument, GrayImage, OcrEngine, ProgressReporter, TextLine } from "./types.ts";
import { cropAndScale } from "./raster.ts";
import { matchName } from "./matching.ts";

/**
 * A candidate assignment of a text line to a tip or node.
 */
type Pairing = {
    /**
     * Tip or node identifier.
     */
    subject: string;

    /**
     * Text line.
     */
    line: TextLine;

    /**
     * How far apart they are.
     */
    distance: number;
};

/**
 * Tells whether a text line is big enough to be a tip label: several glyphs, or a couple of
 * word-sized components.
 *
 * @param line - Text line.
 * @param glyphHeight - Glyph height in pixels.
 * @returns True for label-sized lines.
 */
export function isLabelSized(line: TextLine, glyphHeight: number): boolean
{
    const width = line.box.x1 - line.box.x0;

    return line.glyphCount >= 3 || (line.glyphCount >= 1 && width >= 2 * glyphHeight);
}

/**
 * Orders pairings by distance.
 *
 * @param left - First pairing.
 * @param right - Second pairing.
 * @returns Negative when the first is closer.
 */
function comparePairingDistances(left: Pairing, right: Pairing): number
{
    return left.distance - right.distance;
}

/**
 * Assigns text lines to tips (to the right of the branch end) and to nodes (left of the
 * junction with the parent branch), nearest first, each line used at most once.
 *
 * @param document - Document whose tips, nodes and text lines are updated in place.
 */
export function assignLabels(document: ExtractionDocument): void
{
    const glyph = document.glyphHeight;
    const used = new Set<string>();
    const tipPairings = new Array<Pairing>();

    for (const tip of document.tips)
    {
        for (const line of document.textLines)
        {
            const center = (line.box.y0 + line.box.y1) / 2;
            const offset = line.box.x0 - tip.x;

            if (isLabelSized(line, glyph) && Math.abs(center - tip.y) <= 0.8 * glyph && offset >= -1.5 * glyph && offset <= 5 * glyph)
            {
                tipPairings.push({ subject: tip.id, line, distance: Math.abs(offset) + Math.abs(center - tip.y) });
            }
        }
    }

    tipPairings.sort(comparePairingDistances);

    for (const pairing of tipPairings)
    {
        for (const tip of document.tips)
        {
            if (tip.id === pairing.subject && tip.textLine === null && !used.has(pairing.line.id))
            {
                tip.textLine = pairing.line.id;
                pairing.line.role = "tip";
                used.add(pairing.line.id);
            }
        }
    }

    const nodePairings = new Array<Pairing>();

    for (const node of document.nodes)
    {
        const junctionY = node.attachY ?? (node.y0 + node.y1) / 2;

        for (const line of document.textLines)
        {
            if (used.has(line.id))
            {
                continue;
            }

            const center = (line.box.y0 + line.box.y1) / 2;
            const horizontal = line.box.x1 - node.x;
            const vertical = center - junctionY;

            if (horizontal >= -6 * glyph && horizontal <= 1.5 * glyph && Math.abs(vertical) <= 1.6 * glyph)
            {
                nodePairings.push({ subject: node.id, line, distance: Math.hypot(horizontal, vertical) });
            }
        }
    }

    nodePairings.sort(comparePairingDistances);

    for (const pairing of nodePairings)
    {
        if (pairing.distance > 4 * glyph)
        {
            break;
        }

        for (const node of document.nodes)
        {
            if (node.id === pairing.subject && node.textLine === null && !used.has(pairing.line.id))
            {
                node.textLine = pairing.line.id;
                pairing.line.role = "node";
                used.add(pairing.line.id);
            }
        }
    }

    for (const line of document.textLines)
    {
        if (!used.has(line.id))
        {
            line.role = "unassigned";
        }
    }
}

/**
 * Tidies OCR output for a taxon label: trims decoration and keeps name-like characters.
 *
 * @param text - Raw OCR text.
 * @returns Cleaned label, possibly empty.
 */
export function cleanTaxonText(text: string): string
{
    return text
        .replace(/[^A-Za-z0-9 .'()-]/g, " ")
        .replace(/\s+/g, " ")
        .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.)]+$/g, "")
        .trim();
}

/**
 * Tidies OCR output for a support value: maps look-alike letters to digits and keeps digits,
 * slashes and dots.
 *
 * @param text - Raw OCR text.
 * @returns Cleaned value, possibly empty.
 */
export function cleanSupportText(text: string): string
{
    return text
        .replace(/[lI|]/g, "1")
        .replace(/[oO]/g, "0")
        .replace(/[^0-9/.]/g, "")
        .replace(/^[/.]+|[/.]+$/g, "");
}

/**
 * Finds a text line by identifier.
 *
 * @param document - Document to search.
 * @param id - Text line identifier, or null.
 * @returns The line, or undefined.
 */
function findTextLine(document: ExtractionDocument, id: string | null): TextLine | undefined
{
    if (id === null)
    {
        return undefined;
    }

    for (const line of document.textLines)
    {
        if (line.id === id)
        {
            return line;
        }
    }

    return undefined;
}

/**
 * Reads every assigned text line with the OCR engine and fills in tip and node labels.
 *
 * @param document - Document updated in place.
 * @param erased - Gray image with line art painted out.
 * @param ocr - Engine to read crops with.
 * @param scale - Upscaling factor for crops.
 * @param names - Optional closed list to match tip labels against.
 * @param progress - Receives a count per label read, or null.
 * @returns Resolves when every label has been read.
 */
export async function readLabels(
    document: ExtractionDocument,
    erased: GrayImage,
    ocr: OcrEngine,
    scale: number,
    names: Array<string>,
    progress: ProgressReporter | null = null,
): Promise<void>
{
    const total = document.tips.length + document.nodes.length;
    let done = 0;

    for (const tip of document.tips)
    {
        const line = findTextLine(document, tip.textLine);
        done++;

        if (progress !== null)
        {
            progress.report("Reading labels", done, total);
        }

        if (line !== undefined)
        {
            line.ocr = await ocr.recognize(cropAndScale(erased, line.box, 3, scale, scale * document.profile.font.condensing), "text");
            const cleaned = cleanTaxonText(line.ocr.text);
            tip.label = cleaned.length > 0 ? cleaned : null;
            tip.match = tip.label === null || names.length === 0 ? null : matchName(tip.label, names);
        }
    }

    for (const node of document.nodes)
    {
        const line = findTextLine(document, node.textLine);
        done++;

        if (progress !== null)
        {
            progress.report("Reading labels", done, total);
        }

        if (line !== undefined)
        {
            line.ocr = await ocr.recognize(cropAndScale(erased, line.box, 3, scale), "digits");
            const cleaned = cleanSupportText(line.ocr.text);
            node.label = cleaned.length > 0 ? cleaned : null;
        }
    }
}
