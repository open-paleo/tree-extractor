/**
 * Assigns detected text lines to tips and nodes, reads them with OCR and matches tip labels
 * against a name list.
 */

import type { ExtractionDocument, GrayImage, NameMatch, OcrEngine, ProgressReporter, RotatedFrame, TextLine } from "./types.ts";
import { cropAndScale } from "./raster.ts";
import { mapPointToFrame } from "./geometry.ts";
import { rotateGrayToFrame } from "./slant.ts";
import { matchKnownName, matchName } from "./matching.ts";

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
        // A tip moved to the far side of a shape may now stand inside its label row's box, when
        // the shape touches the label and the two became one glyph; the row may then start as
        // far back as the branch end did.
        const reachBack = 1.5 * glyph + (tip.extendedFrom === undefined ? 0 : tip.x - tip.extendedFrom);

        for (const line of document.textLines)
        {
            // A row found in a level frame is compared with the tip mapped into that frame, and
            // since the glyph height was measured on level fragments of these labels, the row's
            // own height sets the vertical tolerance there.
            const point = line.frame === undefined ? tip : mapPointToFrame(line.frame, tip.x, tip.y);
            const offset = line.box.x0 - point.x;
            // In a frame a label stands on or above its branch, so the tip is measured against
            // the row's bottom edge: from most of a row below it to about two glyphs above.
            const rowHeight = line.box.y1 - line.box.y0;
            const rise = line.frame === undefined ? (line.box.y0 + line.box.y1) / 2 - point.y : line.box.y1 - point.y;
            const fits = line.frame === undefined ? Math.abs(rise) <= 0.8 * glyph : rise <= 0.7 * rowHeight && rise >= -(1.8 * glyph + 0.4 * rowHeight);

            if (isLabelSized(line, glyph) && fits && offset >= -reachBack && offset <= 5 * glyph)
            {
                tipPairings.push({ subject: tip.id, line, distance: Math.abs(offset) + Math.abs(rise) });
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
    const cleaned = text
        .replace(/[^A-Za-z0-9 .'()-]/g, " ")
        .replace(/\s+/g, " ")
        .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.)]+$/g, "")
        .trim();

    return dropRubbleWords(cleaned);
}

/**
 * Whether a word is what a dashed or striped bar reads as: a letter four times in a row,
 * three or fewer different letters in six or more, or five or more with no vowel or digit.
 *
 * @param letters - The word's letters and digits.
 * @returns True for rubble.
 */
export function isRubbleWord(letters: string): boolean
{
    if (/(.)\1\1\1/i.test(letters) || (letters.length > 4 && !/[aeiouy0-9]/i.test(letters)))
    {
        return true;
    }

    return letters.length >= 6 && new Set(letters.toLowerCase()).size <= 3;
}

/**
 * Drops what a dashed or striped bar leaves in a read: words with a letter four times in a
 * row, with three or fewer different letters in six or more ("cmmmmmmmnn", "immemmmeem"), or
 * long with no vowel, and short lowercase words before the first capital ("imi
 * Confuciusornithidae"), since a name starts with a capital.
 *
 * @param text - Cleaned read.
 * @returns The read without the rubble.
 */
function dropRubbleWords(text: string): string
{
    const words = text.split(" ");
    const kept = new Array<string>();

    for (const word of words)
    {
        const letters = word.replace(/[^A-Za-z0-9]/g, "");

        if (letters.length === 0 || isRubbleWord(letters))
        {
            continue;
        }

        if (kept.length === 0 && letters.length <= 3 && letters === letters.toLowerCase() && /[A-Z]/.test(words.slice(words.indexOf(word) + 1).join("")))
        {
            continue;
        }

        kept.push(word);
    }

    return kept.join(" ");
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
 * Matches a label: against the paper's list first, and when that gives nothing accepted,
 * against the known taxa at the stricter bar. The paper's unaccepted match is kept when the
 * known taxa do no better, so the reader still sees the nearest name.
 *
 * @param label - Cleaned label text, or null.
 * @param names - The paper's names, possibly empty.
 * @param knownNames - Known taxa, possibly empty.
 * @returns The match, or null without a label or any list.
 */
function chooseMatch(label: string | null, names: Array<string>, knownNames: Array<string>): NameMatch | null
{
    if (label === null)
    {
        return null;
    }

    // A tip printed in capitals is a collapsed clade (COELURIDAE), not a taxon with a typo;
    // it keeps its printed name unless a list has it exactly.
    if (isCladeName(label))
    {
        const exact = names.length === 0 ? null : matchName(label, names);

        return exact !== null && exact.similarity >= 0.98 ? exact : null;
    }

    // So is a single word with the ending of a family, subfamily, tribe, superfamily or order
    // (Ornithomimosauria, Confuciusornithidae): the list's Ornithomimus is not its name,
    // however well the stem matches.
    if (isHigherTaxonName(label))
    {
        const exact = names.length === 0 ? null : matchName(label, names);

        return exact !== null && exact.similarity >= 0.9 ? exact : null;
    }

    const own = names.length === 0 ? null : matchName(label, names);

    if (own !== null && own.accepted)
    {
        return own;
    }

    const known = knownNames.length === 0 ? null : matchKnownName(label, knownNames);

    if (known !== null && known.accepted)
    {
        return known;
    }

    return own ?? known;
}

/**
 * Whether a label is set in capitals, as collapsed clades are: five or more letters, none of
 * them lower case.
 *
 * @param label - Cleaned label.
 * @returns True for a name in capitals.
 */
export function isHigherTaxonName(label: string): boolean
{
    const word = label.trim();

    return /^[A-Z][a-z]+$/.test(word) && /(sauria|idae|inae|ini|oidea|iformes|morpha|thoraces)$/.test(word);
}

/**
 * Whether a label is printed in capitals, which marks a clade name.
 *
 * @param label - Cleaned label text.
 * @returns True for COELURIDAE and the like.
 */
export function isCladeName(label: string): boolean
{
    const letters = label.replace(/[^A-Za-z]/g, "");

    return letters.length >= 5 && letters === letters.toUpperCase();
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
    knownNames: Array<string>,
    progress: ProgressReporter | null = null,
): Promise<void>
{
    const total = document.tips.length + document.nodes.length;
    const framed = new Map<RotatedFrame, GrayImage>();
    let done = 0;

    // A row in a level frame is cropped from the erased image turned into that frame.
    function chooseSource(line: TextLine): GrayImage
    {
        if (line.frame === undefined)
        {
            return erased;
        }

        let turned = framed.get(line.frame);

        if (turned === undefined)
        {
            turned = rotateGrayToFrame(erased, line.frame);
            framed.set(line.frame, turned);
        }

        return turned;
    }

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
            // The font profile describes the rows in the figure's frame; a row in a level frame
            // is read as it is.
            const condensing = line.frame === undefined ? document.profile.font.condensing : 1;
            line.ocr = await ocr.recognize(cropAndScale(chooseSource(line), line.box, 3, scale, scale * condensing), "text");
            const cleaned = cleanTaxonText(line.ocr.text);
            tip.label = cleaned.length > 0 ? cleaned : null;
            tip.match = chooseMatch(tip.label, names, knownNames);
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
            line.ocr = await ocr.recognize(cropAndScale(chooseSource(line), line.box, 3, scale), "digits");
            const cleaned = cleanSupportText(line.ocr.text);
            node.label = cleaned.length > 0 ? cleaned : null;
        }
    }
}
