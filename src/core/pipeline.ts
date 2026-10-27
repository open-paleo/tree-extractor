/**
 * The extraction pipeline: image in, extraction document out. Pure apart from the injected OCR
 * engine, so it runs in Node and in the browser alike.
 */

import type { Box, ExtractionDocument, GrayImage, Mask, OcrEngine, QcIssue, RgbaImage, TextLine, Tip, TreeNode } from "./types.ts";
import {
    applyHysteresis,
    closeMask,
    compareNumbers,
    computeMedian,
    convertToGray,
    createDarkMask,
    createLongRunMask,
    createMaskFromBoxes,
    dilate,
    paintMask,
    subtractMask,
} from "./raster.ts";
import { detectTextLines } from "./text-lines.ts";
import { extractSegments } from "./segments.ts";
import { traceRectangularTree } from "./tracer.ts";
import { assignLabels, readLabels } from "./labels.ts";
import { getTipDisplayName } from "./newick.ts";

/**
 * Tunable thresholds for the pipeline. Defaults suit figures around 1000 to 2500 pixels wide.
 */
export type Parameters = {
    /**
     * Luminance below which a pixel is text ink.
     */
    inkThreshold: number;

    /**
     * Luminance below which a pixel is line ink. Higher than the text threshold so that faint,
     * antialiased thin lines stay continuous.
     */
    lineThreshold: number;

    /**
     * Luminance below which a pixel may be line ink if it touches certain line ink. Bridges the
     * faint stretches that compression leaves in thin lines.
     */
    lineThresholdWeak: number;

    /**
     * Radius of the morphological close that mends broken thin lines.
     */
    closeRadius: number;

    /**
     * Largest RGB channel spread still treated as black rather than colored.
     */
    maxChroma: number;

    /**
     * Shortest horizontal run stripped before glyph detection.
     */
    glyphStripHorizontalRun: number;

    /**
     * Shortest vertical run stripped before glyph detection.
     */
    glyphStripVerticalRun: number;

    /**
     * Shortest horizontal run that counts as a branch.
     */
    minHorizontalRun: number;

    /**
     * Shortest vertical run that counts as a node connector. Raised automatically to clear the
     * thickness of the horizontals, so thick branches cannot read as short connectors.
     */
    minVerticalRun: number;

    /**
     * Attachment tolerance in pixels, or null to derive it from line thickness.
     */
    attachTolerance: number | null;

    /**
     * How far, in glyph heights, a branch end may sit from its vertical and still be joined.
     * Covers the gap a support label's white background box cuts into a line.
     */
    labelReach: number;

    /**
     * Upscaling factor for OCR crops.
     */
    ocrScale: number;

    /**
     * Rows above this are ignored by text detection.
     */
    textMinY: number;
};

/**
 * Default thresholds.
 */
export const defaultParameters: Parameters = {
    inkThreshold: 140,
    lineThreshold: 180,
    lineThresholdWeak: 230,
    closeRadius: 1,
    maxChroma: 40,
    glyphStripHorizontalRun: 28,
    glyphStripVerticalRun: 20,
    minHorizontalRun: 10,
    minVerticalRun: 6,
    attachTolerance: null,
    labelReach: 6,
    ocrScale: 3,
    textMinY: 0,
};

/**
 * Inputs to one extraction run.
 */
export type ExtractOptions = {
    /**
     * OCR engine, or null to skip label reading.
     */
    ocr: OcrEngine | null;

    /**
     * Closed list of names to match tip labels against; empty to skip matching.
     */
    names: Array<string>;

    /**
     * Threshold overrides.
     */
    parameters: Partial<Parameters>;

    /**
     * Where the image came from, recorded in the document.
     */
    source: string | null;
};

/**
 * Intermediate rasters shared by the pipeline and by diagnostics.
 */
export type PreparedMasks = {
    /**
     * Luminance image.
     */
    gray: GrayImage;

    /**
     * Dark pixels at the text threshold.
     */
    textInk: Mask;

    /**
     * Dark neutral pixels at the line threshold, mended, with glyphs removed.
     */
    lineInk: Mask;

    /**
     * Glyph height from the rough text pass.
     */
    glyphHeight: number;

    /**
     * Text lines from the rough pass, used to reject line art that lies inside a row of text.
     */
    roughLines: Array<TextLine>;
};

/**
 * Builds the masks the tracer works from.
 *
 * @param image - Decoded RGBA image.
 * @param parameters - Thresholds.
 * @returns The masks and the glyph height.
 */
export function prepareMasks(image: RgbaImage, parameters: Parameters): PreparedMasks
{
    const gray = convertToGray(image);
    const textInk = createDarkMask(image, parameters.inkThreshold, false, parameters.maxChroma);
    const strongInk = createDarkMask(image, parameters.lineThreshold, true, parameters.maxChroma);

    // A rough text pass learns the glyph size and finds glyph pixels to keep out of the line art.
    const roughStrip = dilate(createLongRunMask(textInk, parameters.glyphStripHorizontalRun, parameters.glyphStripVerticalRun), 1);
    const rough = detectTextLines(textInk, { lineArtMask: roughStrip, minY: parameters.textMinY });
    const glyphHeight = rough.glyphHeight;

    // Strong ink minus glyphs, except that a glyph pixel on a long straight run of strong ink is a
    // branch or connector touching a label and stays. Faint (weak) ink then extends the strong
    // lines by hysteresis, but never near glyphs, whose compression halos would otherwise join
    // every label to its branch as one wide blob.
    const protectedLength = Math.round(1.5 * glyphHeight);
    const protectedInk = createLongRunMask(strongInk, protectedLength, protectedLength);
    const glyphZone = subtractMask(dilate(rough.glyphMask, 2), protectedInk);
    const weakInk = subtractMask(createDarkMask(image, parameters.lineThresholdWeak, true, parameters.maxChroma), dilate(rough.glyphMask, 4));
    const lineInk = closeMask(applyHysteresis(subtractMask(strongInk, glyphZone), weakInk), parameters.closeRadius);

    return { gray, textInk, lineInk, glyphHeight, roughLines: rough.lines };
}

/**
 * Finds the stretches of line ink that continue a horizontal segment beyond either end without
 * leaving its rows: the tail of a range bar or a branch stub that was clipped at a label.
 *
 * @param lineInk - Line ink mask.
 * @param boxes - Segment boxes.
 * @param reach - How far past an end to look.
 * @returns Boxes covering the stubs.
 */
function findStubExtensions(lineInk: Mask, boxes: Array<Box>, reach: number): Array<Box>
{
    const stubs = new Array<Box>();
    const { width, height, data } = lineInk;

    function staysInside(x: number, box: Box): boolean
    {
        if (x < 0 || x >= width)
        {
            return false;
        }

        let inside = 0;

        for (let y = box.y0; y < box.y1; y++)
        {
            inside += data[y * width + x];
        }

        // A range bar is a little thicker than the branch it sits on; a letter is far taller.
        const above = box.y0 - 3 >= 0 ? data[(box.y0 - 3) * width + x] : 0;
        const below = box.y1 + 2 < height ? data[(box.y1 + 2) * width + x] : 0;

        return inside > 0 && above === 0 && below === 0;
    }

    for (const box of boxes)
    {
        if (box.x1 - box.x0 < box.y1 - box.y0)
        {
            continue;
        }

        let right = box.x1;

        while (right < box.x1 + reach && staysInside(right, box))
        {
            right++;
        }

        let left = box.x0 - 1;

        while (left > box.x0 - 1 - reach && staysInside(left, box))
        {
            left--;
        }

        if (right > box.x1 || left < box.x0 - 1)
        {
            stubs.push({ x0: left + 1, y0: box.y0, x1: right, y1: box.y1 });
        }
    }

    return stubs;
}

/**
 * Removes tips with no label text whose branch is shorter than a couple of glyphs: the crossbar
 * of a digit touching a vertical, the end of a clipped stub. Nodes left with one child collapse.
 *
 * @param document - Document updated in place.
 * @param maxLength - Longest branch a debris tip can have.
 */
function removeDebrisTips(document: ExtractionDocument, maxLength: number): void
{
    const nodeById = new Map<string, TreeNode>();
    const tipById = new Map<string, Tip>();

    for (const node of document.nodes)
    {
        nodeById.set(node.id, node);
    }

    const debris = new Set<string>();

    for (const tip of document.tips)
    {
        const parent = tip.parent === null ? undefined : nodeById.get(tip.parent);

        if (tip.textLine === null && parent !== undefined && tip.x - parent.x < maxLength)
        {
            debris.add(tip.id);
        }
        else
        {
            tipById.set(tip.id, tip);
        }
    }

    if (debris.size === 0)
    {
        return;
    }

    document.tips = [...tipById.values()];

    for (const node of document.nodes)
    {
        const kept = new Array<string>();

        for (const child of node.children)
        {
            if (!debris.has(child))
            {
                kept.push(child);
            }
        }

        node.children = kept;
    }

    document.qc.push({ severity: "info", code: "debris-removed", message: `${debris.size} short unlabelled tip(s) dropped as debris`, subject: null });
    let changed = true;

    while (changed)
    {
        changed = false;

        for (const node of [...nodeById.values()])
        {
            if (node.children.length > 1)
            {
                continue;
            }

            const childId = node.children[0];
            const child = childId === undefined ? undefined : (nodeById.get(childId) ?? tipById.get(childId));

            if (child !== undefined)
            {
                child.parent = node.parent;
            }

            const parent = node.parent === null ? undefined : nodeById.get(node.parent);

            if (parent !== undefined)
            {
                const index = parent.children.indexOf(node.id);

                if (index >= 0 && childId === undefined)
                {
                    parent.children.splice(index, 1);
                }
                else if (index >= 0)
                {
                    parent.children[index] = childId;
                }
            }

            if (document.root === node.id)
            {
                document.root = childId !== undefined && nodeById.has(childId) ? childId : null;
            }

            nodeById.delete(node.id);
            changed = true;
        }
    }

    document.nodes = [...nodeById.values()];
}

/**
 * Adds quality-control findings about labels and overall shape.
 *
 * @param document - Document whose qc list is extended.
 */
function runQualityChecks(document: ExtractionDocument): void
{
    const issues = new Array<QcIssue>();
    const seen = new Map<string, string>();

    for (const tip of document.tips)
    {
        if (tip.textLine === null)
        {
            issues.push({ severity: "warning", code: "tip-unlabelled", message: `tip ${tip.id} has no label text nearby`, subject: tip.id });
        }
        else if (tip.match !== null && !tip.match.accepted)
        {
            issues.push({
                severity: "warning",
                code: "label-unmatched",
                message: `tip ${tip.id} read as "${tip.label ?? ""}" matches nothing in the name list (best ${tip.match.name}, ${tip.match.similarity.toFixed(2)})`,
                subject: tip.id,
            });
        }

        const name = getTipDisplayName(document, tip.id);
        const earlier = seen.get(name);

        if (earlier !== undefined)
        {
            issues.push({ severity: "error", code: "duplicate-name", message: `tips ${earlier} and ${tip.id} both resolve to "${name}"`, subject: tip.id });
        }
        else
        {
            seen.set(name, tip.id);
        }
    }

    issues.push({
        severity: "info",
        code: "summary",
        message: `${document.tips.length} tip(s), ${document.nodes.length} node(s), ${document.textLines.length} text line(s)`,
        subject: null,
    });

    document.qc.push(...issues);
}

/**
 * Formats stage timings for display.
 *
 * @param timings - Milliseconds per stage.
 * @returns Comma-separated summary.
 */
export function formatTimings(timings: Record<string, number>): string
{
    const parts = new Array<string>();

    for (const stage of Object.keys(timings))
    {
        parts.push(`${stage} ${timings[stage]} ms`);
    }

    return parts.join(", ");
}

/**
 * Runs the full pipeline on one image.
 *
 * @param image - Decoded RGBA image.
 * @param options - OCR engine, name list and threshold overrides.
 * @returns The extraction document.
 */
export async function extractTree(image: RgbaImage, options: Partial<ExtractOptions> = {}): Promise<ExtractionDocument>
{
    const parameters = { ...defaultParameters, ...options.parameters };
    const names = options.names ?? [];
    const timings: Record<string, number> = {};
    let clock = performance.now();

    function recordLap(stage: string): void
    {
        const now = performance.now();
        timings[stage] = Math.round(now - clock);
        clock = now;
    }

    const { gray, textInk, lineInk, glyphHeight, roughLines } = prepareMasks(image, parameters);
    recordLap("masks");

    const probe = extractSegments(lineInk, parameters.minHorizontalRun, Number.MAX_SAFE_INTEGER);
    const thicknesses = new Array<number>();

    for (const segment of probe.horizontals)
    {
        thicknesses.push(segment.box.y1 - segment.box.y0);
    }

    thicknesses.sort(compareNumbers);
    const thickness = computeMedian(thicknesses, 2);
    const thickest = thicknesses.length === 0 ? thickness : thicknesses[Math.floor(thicknesses.length * 0.9)];
    const minVerticalRun = Math.max(parameters.minVerticalRun, Math.round(1.5 * thickest) + 1);

    // A support label drawn over a branch with a white background box can hide up to its own
    // width of line; horizontal pieces are rejoined across that much, verticals across far less.
    const reach = Math.round(parameters.labelReach * glyphHeight);

    // Rows of label text, widened by a glyph on each side because a first letter that touches
    // its branch is often missing from the rough pass. Line art is clipped out of them. Short rows
    // are support values, which sit on branches and must not clip them.
    const textRows = new Array<Box>();

    for (const line of roughLines)
    {
        if (line.glyphCount >= 5 && line.box.x1 - line.box.x0 >= 3 * glyphHeight)
        {
            textRows.push({ x0: line.box.x0 - glyphHeight, y0: line.box.y0 - 2, x1: line.box.x1 + glyphHeight, y1: line.box.y1 + 2 });
        }
    }

    const { horizontals, verticals } = extractSegments(
        lineInk,
        parameters.minHorizontalRun,
        minVerticalRun,
        reach,
        Math.round(1.2 * glyphHeight),
        textInk,
        glyphHeight,
        textRows,
    );
    recordLap("segments");

    // A branch end sits within about one line width of its vertical; anything looser lets a
    // tip's branch reach the wrong node.
    const tolerance = parameters.attachTolerance ?? Math.max(3, Math.round(thickness) + 2);
    const trace = traceRectangularTree(horizontals, verticals, tolerance, reach);
    recordLap("trace");

    // Line art is what the trace used; everything else is text or noise. Range bars and branch
    // stubs that run on past a used segment into a label are erased with it.
    const usedBoxes = new Array<Box>();

    for (const segment of horizontals)
    {
        if (trace.usedSegments.has(segment.id))
        {
            usedBoxes.push(segment.box);
        }
    }

    for (const segment of verticals)
    {
        if (trace.usedSegments.has(segment.id))
        {
            usedBoxes.push(segment.box);
        }
    }

    const lineArtBoxes = [...usedBoxes, ...findStubExtensions(lineInk, usedBoxes, glyphHeight)];
    const lineArtMask = dilate(createMaskFromBoxes(lineArtBoxes, image.width, image.height), 1);
    const text = detectTextLines(textInk, { lineArtMask, minY: parameters.textMinY });
    recordLap("text");

    const document: ExtractionDocument = {
        version: 1,
        image: { width: image.width, height: image.height, source: options.source ?? null },
        horizontals,
        verticals,
        textLines: text.lines,
        nodes: trace.nodes,
        tips: trace.tips,
        root: trace.root,
        qc: [...trace.issues],
        rejectedVerticals: trace.rejected,
        branches: trace.branches,
        glyphHeight: text.glyphHeight,
        timings,
    };

    assignLabels(document);
    removeDebrisTips(document, 2.5 * glyphHeight);
    recordLap("assign");

    if (options.ocr)
    {
        const erased = paintMask(gray, lineArtMask, 255);
        await readLabels(document, erased, options.ocr, parameters.ocrScale, names);
        recordLap("ocr");
    }

    runQualityChecks(document);

    return document;
}
