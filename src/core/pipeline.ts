/**
 * The extraction pipeline: image in, extraction document out. Pure apart from the injected OCR
 * engine, so it runs in Node and in the browser alike.
 */

import type { Box, ExtractionDocument, GrayImage, Mask, OcrEngine, Orientation, ProfileOverrides, ProgressReporter, QcIssue, RgbaImage, Segment, TextLine, Tip, TreeNode } from "./types.ts";
import { applyProfileOverrides, createEmptyProfile, measureProfile, measureTextMarks } from "./profile.ts";
import { checkTipAlignment, recoverAlignedTips } from "./alignment.ts";
import { pruneDecorations } from "./decorations.ts";
import { chooseRoot } from "./tree.ts";
import { detectOrientation } from "./orientation.ts";
import { detectSlantedLabels } from "./slant.ts";
import { traceSlantedTree } from "./slanted.ts";
import type { SlantedLabels } from "./slant.ts";
import type { OrientationFind } from "./orientation.ts";
import { assignAges, calibrateAxis } from "./timescale.ts";
import type { ChartStripFind } from "./markers.ts";
import { createColoredMask, extendTipsThroughMarkers, findFatShapes, findNodeDiscs, keepSmallShapes, paintCrosses, removeChartLines, removeChartStrips, removeFrameSegments, splitColoredInk } from "./markers.ts";
import {
    applyHysteresis,
    closeMask,
    invertMask,
    compareNumbers,
    convertToGray,
    createDarkMask,
    createDirectionalRunMask,
    createLongRunMask,
    createMaskFromBoxes,
    dilate,
    estimateLineThickness,
    keepComponentsTouching,
    paintMask,
    rotateRgbaQuarter,
    subtractMask,
    unionMask,
} from "./raster.ts";
import { detectTextLines } from "./text-lines.ts";
import { extractSegments, findShortConnectors } from "./segments.ts";
import { traceRectangularTree } from "./tracer.ts";
import { assignLabels, readLabels, isCladeName, isHigherTaxonName } from "./labels.ts";
import { getTipDisplayName } from "./newick.ts";
import { normalizeName, scoreName } from "./matching.ts";
import { clampBox, cropImage, rotateBox, translateDocument } from "./geometry.ts";
import { deleteTip } from "./edit.ts";

/**
 * Tunable thresholds for the pipeline. Defaults suit figures around 1000 to 2500 pixels wide.
 */
export type Parameters = {
    /**
     * Luminance below which a pixel is certainly text ink.
     */
    inkThreshold: number;

    /**
     * Luminance below which a pixel is text ink if it touches certain text ink. Reconnects the
     * hairlines of thin fonts, which break into fragments at the strict threshold.
     */
    inkThresholdWeak: number;

    /**
     * Glyph height, in pixels, at or below which text counts as small and gets the weak text
     * threshold regardless of fragmentation.
     */
    smallGlyphHeight: number;

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
     * Largest channel spread for weak line ink. Tighter than maxChroma because a faint stretch
     * of a black line is gray, while a pastel clade box can be nearly as light and nearly as
     * neutral.
     */
    weakMaxChroma: number;

    /**
     * How far, in pixels, weak ink may lie from certain line ink. A faint gap in a line is a
     * few pixels from certain ink on both sides; a pastel fill stretches far from any line and
     * must not be flooded.
     */
    weakReach: number;

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
     * Glyph height in pixels that label crops are scaled towards before OCR; the scale never
     * exceeds ocrScale or drops under one.
     */
    ocrGlyphTarget: number;

    /**
     * Rows above this are ignored by text detection.
     */
    textMinY: number;

    /**
     * Luminance below which a colored pixel counts as dark enough to be a line or a marker.
     */
    coloredThreshold: number;

    /**
     * Chroma a dark pixel must exceed to count as colored ink; JPEG fringes along black lines
     * on tinted backgrounds stay below it.
     */
    coloredMinChroma: number;

    /**
     * Half-width of the erosion that tells a fat colored shape from a thin colored line.
     */
    markerRadius: number;

    /**
     * Whether to add the short connectors between close verticals of a pectinate tree.
     */
    shortConnectors: boolean;

    /**
     * Whether a tip's end moves through a solid shape or a colored marker it touches.
     */
    extendThroughShapes: boolean;

    /**
     * Share of a gap's columns that must hold ink before two collinear pieces are joined.
     */
    gapInkShare: number;

    /**
     * Whether to detect a tree drawn on its side and turn it ("auto"), or to take the image
     * as it is ("none").
     */
    rotation: "auto" | "none";

    /**
     * Paint a cross through filled node discs so that the branches they cover connect.
     */
    nodeDiscs: boolean;

    /**
     * Whether to drop a stage chart along the top or bottom edge before tracing.
     */
    chartStrips: boolean;

    /**
     * Whether tips extend through shapes in any pale tint, such as light range bars.
     */
    paleMarkers: boolean;

    /**
     * Read a slanted figure from the skeleton of its line art.
     */
    slantedTrees: boolean;

    /**
     * Drop short unlabelled tips as debris; off, they stay, for seeing what the trace found.
     */
    dropDebris: boolean;

    /**
     * Look for tip labels set at a slant and read them in a level frame.
     */
    slantedLabels: boolean;

    /**
     * Smallest label slant in degrees that gets a level frame.
     */
    minLabelSlant: number;

    /**
     * Profile values fixed by the caller instead of measured.
     */
    profileOverrides: ProfileOverrides;
};

/**
 * Default thresholds.
 */
export const defaultParameters: Parameters = {
    inkThreshold: 140,
    inkThresholdWeak: 200,
    smallGlyphHeight: 7,
    lineThreshold: 180,
    lineThresholdWeak: 230,
    closeRadius: 1,
    maxChroma: 40,
    weakMaxChroma: 40,
    weakReach: 3,
    glyphStripHorizontalRun: 28,
    glyphStripVerticalRun: 20,
    minHorizontalRun: 10,
    minVerticalRun: 6,
    attachTolerance: null,
    labelReach: 6,
    ocrScale: 3,
    ocrGlyphTarget: 45,
    textMinY: 0,
    coloredThreshold: 150,
    coloredMinChroma: 100,
    markerRadius: 4,
    shortConnectors: false,
    extendThroughShapes: true,
    gapInkShare: 0.4,
    rotation: "auto",
    nodeDiscs: true,
    chartStrips: true,
    paleMarkers: true,
    slantedTrees: true,
    dropDebris: true,
    slantedLabels: true,
    minLabelSlant: 6,
    profileOverrides: {},
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
     * Known taxa of the whole data set, matched as a second tier after the names; empty to
     * skip.
     */
    knownNames?: Array<string>;

    /**
     * Threshold overrides.
     */
    parameters: Partial<Parameters>;

    /**
     * Where the image came from, recorded in the document.
     */
    source: string | null;

    /**
     * Part of the image to analyze, or null for all of it. Results are reported in the full
     * image's coordinates either way.
     */
    region: Box | null;

    /**
     * Receives stage progress, or null.
     */
    progress: ProgressReporter | null;
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
     * Glyph pixels from the rough text pass.
     */
    glyphMask: Mask;

    /**
     * Fat colored shapes: range ovals, markers and fills, kept out of the line ink.
     */
    markers: Mask;

    /**
     * Fat shapes in any tint, however pale: the light green and pink range bars of a time tree
     * are too light for the ink masks and too neutral for the colored one, yet a branch ends at
     * one and its label lies beyond it.
     */
    paleMarkers: Mask;

    /**
     * Whether the strict text threshold broke letters into fragments.
     */
    fragmented: boolean;

    /**
     * Whether the text ink was widened by hysteresis.
     */
    widened: boolean;

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
    let textInk = createDarkMask(image, parameters.inkThreshold, false, parameters.maxChroma);
    // Lines drawn in color join the line ink; colored markers and fills stay out of it and are
    // kept aside, since a tip's branch may end at one and its label lie beyond it.
    const colored = splitColoredInk(image, parameters.coloredThreshold, parameters.coloredMinChroma, parameters.markerRadius);
    const paleMarkers = findFatShapes(createColoredMask(image, 235, 30), parameters.markerRadius);
    const strongInk = unionMask(createDarkMask(image, parameters.lineThreshold, true, parameters.maxChroma), colored.thin);

    // A rough text pass learns the glyph size and finds glyph pixels to keep out of the line art.
    // The runs stripped as line art must be longer than a letter stroke, so when the first pass
    // finds large glyphs the strip is scaled up and the pass repeated.
    let stripHorizontal = parameters.glyphStripHorizontalRun;
    let stripVertical = parameters.glyphStripVerticalRun;
    let roughStrip = dilate(createLongRunMask(textInk, stripHorizontal, stripVertical), 1);
    let rough = detectTextLines(textInk, { lineArtMask: roughStrip, minY: parameters.textMinY });

    for (let pass = 0; pass < 3 && (2.3 * rough.glyphHeight > stripHorizontal || 1.7 * rough.glyphHeight > stripVertical); pass++)
    {
        stripHorizontal = Math.max(stripHorizontal, Math.round(2.3 * rough.glyphHeight));
        stripVertical = Math.max(stripVertical, Math.round(1.7 * rough.glyphHeight));
        roughStrip = dilate(createLongRunMask(textInk, stripHorizontal, stripVertical), 1);
        rough = detectTextLines(textInk, { lineArtMask: roughStrip, minY: parameters.textMinY });
    }

    // A thin font breaks into fragments at the strict threshold, and very small text always
    // loses strokes to it. Fainter pixels that touch certain text ink then rejoin the strokes.
    // Bold text at normal sizes is left alone, since its halo would merge letters and rows.
    // A profile override settles the question either way.
    const fragmented = rough.fragmented;
    const widened = parameters.profileOverrides.widenText ?? (fragmented || rough.glyphHeight <= parameters.smallGlyphHeight);

    if (widened)
    {
        textInk = applyHysteresis(textInk, createDarkMask(image, parameters.inkThresholdWeak, false, parameters.maxChroma));
        roughStrip = dilate(createLongRunMask(textInk, stripHorizontal, stripVertical), 1);
        rough = detectTextLines(textInk, { lineArtMask: roughStrip, minY: parameters.textMinY });
    }

    const glyphHeight = rough.glyphHeight;

    // Strong ink minus glyphs, except that a glyph pixel on a long straight run of strong ink is a
    // branch or connector touching a label and stays. Faint (weak) ink then extends the strong
    // lines by hysteresis, but never near glyphs, whose compression halos would otherwise join
    // every label to its branch as one wide blob.
    // A short branch stub that joins a long vertical is protected too: it is shorter than any
    // glyph-safe run, but no letter reaches that far along one row while touching a line.
    const protectedLength = Math.round(1.5 * glyphHeight);
    const longInk = createLongRunMask(strongInk, protectedLength, protectedLength);
    const stubLength = Math.max(parameters.minHorizontalRun, Math.round(0.75 * glyphHeight));
    const stubInk = keepComponentsTouching(createDirectionalRunMask(strongInk, stubLength, true), longInk);
    const protectedInk = unionMask(longInk, stubInk);
    const glyphZone = subtractMask(dilate(rough.glyphMask, 2), protectedInk);
    const strongLines = subtractMask(strongInk, glyphZone);
    const nearStrong = dilate(strongLines, parameters.weakReach);
    const weakCandidates = createDarkMask(image, parameters.lineThresholdWeak, true, parameters.weakMaxChroma);
    const weakInk = subtractMask(subtractMask(weakCandidates, invertMask(nearStrong)), dilate(rough.glyphMask, 4));
    const lineInk = closeMask(applyHysteresis(strongLines, weakInk), parameters.closeRadius);

    return { gray, textInk, lineInk, glyphMask: rough.glyphMask, markers: colored.fat, paleMarkers, fragmented, widened, glyphHeight, roughLines: rough.lines };
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
 * Length of the horizontal segment that ends at a tip, or infinity when none is found (a tip
 * added by hand has no segment).
 *
 * @param document - Extraction document.
 * @param tip - Tip to measure.
 * @returns Segment length in pixels.
 */
function measureTipPiece(document: ExtractionDocument, tip: Tip): number
{
    for (const segment of document.horizontals)
    {
        const { box } = segment;

        if (Math.abs(box.x1 - tip.x) <= 1 && tip.y >= box.y0 - 1 && tip.y <= box.y1 + 1)
        {
            return box.x1 - box.x0;
        }
    }

    return Infinity;
}

/**
 * Removes tips with no label text whose branch is shorter than a couple of glyphs: the crossbar
 * of a digit touching a vertical, the end of a clipped stub. Nodes left with one child collapse.
 *
 * @param document - Document updated in place.
 * @param maxLength - Longest branch a debris tip can have.
 * @param minPiece - Shortest line piece a real tip can end; shorter pieces are debris whatever their reach.
 */
function removeDebrisTips(document: ExtractionDocument, maxLength: number, minPiece: number): void
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
        // The piece of line that ends at the tip may be far shorter than its reach from the
        // parent when it attached loosely: the tip of a clade bracket, or a fleck.
        const piece = measureTipPiece(document, tip);

        if (tip.textLine === null && parent !== undefined && (tip.x - parent.x < maxLength || piece < minPiece))
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
 * Drops short tips whose label is not a name: a bare number (a fragment of a branch cut by a
 * support value, which then claimed the value as its label) or a scrap of two or three
 * characters that matched nothing. The line goes back to the pool.
 *
 * @param document - Document updated in place.
 * @param maxLength - Longest branch such a tip can have.
 */
function removeNumericDebrisTips(document: ExtractionDocument, maxLength: number, maxScrapLength = maxLength): void
{
    for (const tip of document.tips)
    {
        if (tip.label === null)
        {
            continue;
        }

        const numeric = /^[0-9./]+$/.test(tip.label);
        const scrap = tip.label.length <= 3 && (tip.match === null || !tip.match.accepted);

        if (!numeric && !scrap)
        {
            continue;
        }

        const limit = numeric ? maxLength : maxScrapLength;

        let parentX: number | null = null;

        for (const node of document.nodes)
        {
            if (node.id === tip.parent)
            {
                parentX = node.x;
            }
        }

        if (parentX !== null && tip.x - parentX < limit)
        {
            for (const line of document.textLines)
            {
                if (line.id === tip.textLine)
                {
                    line.role = "unassigned";
                }
            }

            tip.textLine = null;
            tip.label = null;
            tip.match = null;
        }
    }

    removeDebrisTips(document, maxScrapLength, 0);
}

/**
 * Pairs tips whose label matched nothing confidently with the names no other tip took. Every
 * name is used once, so once the confident matches are made the leftovers can be paired by
 * best similarity, weakest last, as long as the pairing is not a toss-up.
 *
 * @param document - Document updated in place.
 * @param names - The closed list of names.
 */
function assignLeftoverNames(document: ExtractionDocument, names: Array<string>): void
{
    if (names.length === 0)
    {
        return;
    }

    const taken = new Set<string>();
    const open = new Array<Tip>();

    for (const tip of document.tips)
    {
        if (tip.match !== null && tip.match.accepted)
        {
            taken.add(tip.match.name);
        }
        else if (tip.label !== null && !isCladeName(tip.label) && !isHigherTaxonName(tip.label))
        {
            open.push(tip);
        }
    }

    const free = new Array<string>();

    for (const name of names)
    {
        if (!taken.has(name))
        {
            free.push(name);
        }
    }

    let paired = 0;
    let changed = true;

    // Each round pairs every tip whose best free name is clear of its second-best, then the
    // taken names drop out and the remaining tips are tried again with fewer choices.
    while (changed)
    {
        changed = false;

        for (const tip of [...open])
        {
            const label = normalizeName(tip.label ?? "");
            let bestName: string | null = null;
            let bestScore = 0.4;
            let runnerUp = 0;

            for (const name of free)
            {
                const score = scoreName(label, normalizeName(name));

                if (score > bestScore)
                {
                    runnerUp = bestScore;
                    bestScore = score;
                    bestName = name;
                }
                else if (score > runnerUp)
                {
                    runnerUp = score;
                }
            }

            if (bestName === null || bestScore - runnerUp < 0.05)
            {
                continue;
            }

            tip.match = { name: bestName, similarity: bestScore, margin: bestScore - runnerUp, accepted: true, source: "list" };
            open.splice(open.indexOf(tip), 1);
            free.splice(free.indexOf(bestName), 1);
            paired++;
            changed = true;
        }
    }

    if (paired > 0)
    {
        document.qc.push({ severity: "info", code: "leftover-names", message: `${paired} tip(s) paired with the remaining names by elimination; check them`, subject: null });
    }
}

/**
 * Adds quality-control findings about labels and overall shape.
 *
 * @param document - Document whose qc list is extended.
 */
function runQualityChecks(document: ExtractionDocument): void
{
    for (const tip of document.tips)
    {
        if (tip.match !== null && tip.match.accepted && tip.match.source === "known")
        {
            document.qc.push({
                severity: "warning",
                code: "known-name-used",
                message: `tip ${tip.id} read as "${tip.label ?? ""}" matched "${tip.match.name}" from the known taxa, not from the supplied name list`,
                subject: tip.id,
            });
        }
    }

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
 * Keeps the part of a mask from a little left of the tips' median column onward, and clears
 * the rest.
 *
 * @param mask - Mask, copied.
 * @param tips - Tips whose median column sets the line.
 * @param margin - How far left of the median to keep, in pixels.
 * @returns The clipped copy.
 */
function keepShapesBeyond(mask: Mask, tips: Array<Tip>, margin: number): Mask
{
    const xs = new Array<number>();

    for (const tip of tips)
    {
        if (tip.parent !== null)
        {
            xs.push(tip.x);
        }
    }

    xs.sort(compareNumbers);
    const from = xs.length === 0 ? 0 : Math.max(0, Math.round(xs[Math.floor(xs.length / 2)] - margin));
    const data = new Uint8Array(mask.data);

    for (let y = 0; y < mask.height; y++)
    {
        data.fill(0, y * mask.width, y * mask.width + Math.min(from, mask.width));
    }

    return { width: mask.width, height: mask.height, data };
}

/**
 * On a slanted figure whose tips end on one line, drops unlabelled tips that end well behind
 * it: pieces of a bracket or a letter that touched the tree and were read as stubs.
 *
 * @param document - Document with its profile measured and labels paired.
 * @param glyphHeight - Glyph height in pixels.
 * @returns One informational issue per tip dropped.
 */
function dropTipsBehindLine(document: ExtractionDocument, glyphHeight: number): Array<QcIssue>
{
    const issues = new Array<QcIssue>();
    const xs = new Array<number>();

    for (const tip of document.tips)
    {
        if (tip.parent !== null)
        {
            xs.push(tip.x);
        }
    }

    if (xs.length < 4)
    {
        return issues;
    }

    // The tip line of a slanted figure is looser than a rectangular one's, since stubs and
    // markers end at slightly different columns: the median, with most tips within a glyph.
    xs.sort(compareNumbers);
    const line = xs[Math.floor(xs.length / 2)];
    let near = 0;

    for (const x of xs)
    {
        near += Math.abs(x - line) <= glyphHeight ? 1 : 0;
    }

    if (near < 0.6 * xs.length)
    {
        return issues;
    }

    const behind = new Array<string>();

    for (const tip of document.tips)
    {
        if (tip.textLine === null && tip.x < line - 2 * glyphHeight)
        {
            behind.push(tip.id);
        }
    }

    for (const id of behind)
    {
        deleteTip(document, id);
        issues.push({ severity: "info", code: "tip-behind-line", message: `tip ${id} ended well behind the tip line with no label and was dropped`, subject: null });
    }

    return issues;
}

/**
 * Drops tips that lie on the time axis: the axis line traces as a branch when a tick or a
 * frame line connects it to the tree, and its ends then read the legend or the axis labels.
 *
 * @param document - Document with its profile measured.
 * @param glyphHeight - Glyph height in pixels.
 * @returns One informational issue per tip dropped.
 */
function dropAxisTips(document: ExtractionDocument, glyphHeight: number): Array<QcIssue>
{
    const axis = document.profile.timeScaled.axis;
    const issues = new Array<QcIssue>();

    if (axis === null)
    {
        return issues;
    }

    const onAxis = new Array<string>();

    for (const tip of document.tips)
    {
        if (tip.y >= axis.y0 - glyphHeight && tip.y <= axis.y1 + glyphHeight && tip.x >= axis.x0 - 2 * glyphHeight && tip.x <= axis.x1 + 2 * glyphHeight)
        {
            onAxis.push(tip.id);
        }
    }

    for (const id of onAxis)
    {
        deleteTip(document, id);
        issues.push({ severity: "info", code: "axis-tip-dropped", message: `tip ${id} lay on the time axis and was dropped`, subject: null });
    }

    return issues;
}

/**
 * Replaces the level rows that lie in the slanted labels' zone with the rows found in the
 * level frame, numbering the frame's rows on from the rest.
 *
 * @param lines - Rows found in the figure's frame.
 * @param slanted - Rows found in the level frame, with the zone they cover.
 * @returns The combined rows.
 */
function replaceZoneLines(lines: Array<TextLine>, slanted: SlantedLabels): Array<TextLine>
{
    const { zone } = slanted;
    const kept = new Array<TextLine>();
    let highest = 0;

    for (const line of lines)
    {
        const centerX = (line.box.x0 + line.box.x1) / 2;
        const centerY = (line.box.y0 + line.box.y1) / 2;
        highest = Math.max(highest, Number(line.id.slice(1)) || 0);

        if (!(centerX >= zone.x0 && centerX < zone.x1 && centerY >= zone.y0 && centerY < zone.y1))
        {
            kept.push(line);
        }
    }

    // Numbered on from the highest id the figure's rows had, dropped ones included, so that no
    // id is used twice.
    for (const line of slanted.lines)
    {
        highest++;
        line.id = `l${highest}`;
        kept.push(line);
    }

    return kept;
}

/**
 * Records how the figure's orientation was decided, when it was turned or could not be
 * decided.
 *
 * @param find - The detector's decision and evidence, or null when detection was off.
 * @param quarterTurns - Clockwise quarter turns applied.
 * @returns At most one informational issue.
 */
function describeOrientation(find: OrientationFind | null, quarterTurns: number): Array<QcIssue>
{
    if (find === null || find.orientation === "root-left")
    {
        return [];
    }

    const evidence = `${find.rightEnds} branch end(s) with a label to the right, ${find.topEnds} with one above, ${find.bottomEnds} with one below; ${find.uprightGlyphs} glyph(s) level, ${find.sidewaysGlyphs} on their side`;

    if (find.orientation === "unknown")
    {
        return [{ severity: "info", code: "orientation-undecided", message: `the figure's orientation could not be decided (${evidence}; ${Math.round(100 * find.runCoverage)}% of the line art in straight runs), so it was taken as drawn`, subject: null }];
    }

    return [{ severity: "info", code: "figure-turned", message: `the figure was turned ${quarterTurns === 1 ? "clockwise" : "counterclockwise"} to put the root on the left (${evidence})`, subject: null }];
}

/**
 * Runs the full pipeline on one image.
 *
 * @param sourceImage - Decoded RGBA image, as drawn.
 * @param options - OCR engine, name list, region and threshold overrides.
 * @returns The extraction document.
 */
export async function extractTree(sourceImage: RgbaImage, options: Partial<ExtractOptions> = {}): Promise<ExtractionDocument>
{
    const parameters = { ...defaultParameters, ...options.parameters };
    const sourceRegion = options.region === undefined || options.region === null ? null : clampBox(options.region, sourceImage.width, sourceImage.height);

    if (sourceRegion !== null && (sourceRegion.x1 - sourceRegion.x0 < 1 || sourceRegion.y1 - sourceRegion.y0 < 1))
    {
        throw new Error("the region to analyze is empty");
    }

    // A tree drawn on its side is turned so that its root is on the left. The decision is made
    // on the region alone, since the rest of a page can stand any way; everything after this
    // works in the turned frame, and the document says how many turns it took.
    const sourceCrop = sourceRegion === null ? sourceImage : cropImage(sourceImage, sourceRegion);
    const orientationStarted = performance.now();
    const orientationFind = parameters.rotation === "auto" ? detectOrientation(sourceCrop, parameters.inkThreshold, parameters.lineThreshold, parameters.maxChroma) : null;
    const orientation: Orientation = orientationFind === null ? "root-left" : orientationFind.orientation;
    const slantedFigure = parameters.slantedTrees && orientationFind !== null && orientationFind.slanted;
    const quarterTurns = orientation === "root-bottom" ? 1 : orientation === "root-top" ? 3 : 0;
    const image = quarterTurns === 0 ? sourceCrop : rotateRgbaQuarter(sourceCrop, quarterTurns === 1);
    const orientationIssues = describeOrientation(orientationFind, quarterTurns);
    const fullWidth = quarterTurns % 2 === 0 ? sourceImage.width : sourceImage.height;
    const fullHeight = quarterTurns % 2 === 0 ? sourceImage.height : sourceImage.width;
    const region = sourceRegion === null ? null : rotateBox(sourceRegion, sourceImage.width, sourceImage.height, quarterTurns);
    const names = options.names ?? [];
    const knownNames = options.knownNames ?? [];
    const timings: Record<string, number> = { orientation: Math.round(performance.now() - orientationStarted) };
    let clock = performance.now();

    const progress = options.progress ?? null;

    function recordLap(stage: string): void
    {
        const now = performance.now();
        timings[stage] = Math.round(now - clock);
        clock = now;
    }

    function announce(stage: string): void
    {
        if (progress !== null)
        {
            progress.report(stage, 0, 0);
        }
    }

    announce("Preparing masks");
    const { gray, textInk, lineInk, glyphMask, markers, paleMarkers, fragmented, widened, glyphHeight, roughLines } = prepareMasks(image, parameters);
    recordLap("masks");
    announce("Finding segments");

    // The shortest run that counts as a line must exceed the line thickness, or a thick vertical
    // reads as a stack of short horizontal runs and glues every branch it touches into one blob.
    const thickness = estimateLineThickness(lineInk);
    const minHorizontalRun = Math.max(parameters.minHorizontalRun, 2 * thickness);

    // A numbered disc over a junction cuts the branches there; a cross painted through it, in
    // the copy the segments are taken from, lets them run on.
    const nodeDiscs = parameters.nodeDiscs ? findNodeDiscs(textInk, lineInk, glyphHeight, thickness, createDarkMask(image, 230, false, parameters.maxChroma)) : [];
    const lineArt: Mask = { width: lineInk.width, height: lineInk.height, data: new Uint8Array(lineInk.data) };
    paintCrosses(lineArt, nodeDiscs, thickness);
    // The extractor judges a run's thickness on the text ink around it, so the disc goes there too.
    const inkForRuns: Mask = nodeDiscs.length === 0 ? textInk : { width: textInk.width, height: textInk.height, data: new Uint8Array(textInk.data) };
    paintCrosses(inkForRuns, nodeDiscs, thickness);
    const probe = extractSegments(lineArt, minHorizontalRun, Number.MAX_SAFE_INTEGER);
    const thicknesses = new Array<number>();

    // Only long pieces count: a silhouette or a box is a blob of wide runs, not a thick line,
    // and would push the shortest vertical run past the figure's own node connectors.
    for (const segment of probe.horizontals)
    {
        const width = segment.box.x1 - segment.box.x0;
        const height = segment.box.y1 - segment.box.y0;

        if (width >= 4 * height)
        {
            thicknesses.push(height);
        }
    }

    thicknesses.sort(compareNumbers);
    const thickest = thicknesses.length === 0 ? thickness : thicknesses[Math.floor(thicknesses.length * 0.9)];
    const minVerticalRun = Math.max(parameters.minVerticalRun, 2 * thickness, Math.round(1.5 * thickest) + 1);

    // A support label drawn over a branch with a white background box can hide up to its own
    // width of line; horizontal pieces are rejoined across that much, verticals across far less.
    const reach = Math.round(parameters.labelReach * glyphHeight);

    // Rows of label text, widened by a glyph on each side because a first letter that touches
    // its branch is often missing from the rough pass. Line art is clipped out of them. Short rows
    // are support values, which sit on branches and must not clip them.
    const textRows = new Array<Box>();
    const labelRows = new Array<Box>();

    for (const line of roughLines)
    {
        // Touching letters, or an underscore joining words, can make a whole label one component.
        const width = line.box.x1 - line.box.x0;
        const wordsMerged = width >= 6 * glyphHeight;

        if ((line.glyphCount >= 5 || wordsMerged) && width >= 3 * glyphHeight)
        {
            labelRows.push(line.box);
            textRows.push({ x0: line.box.x0 - glyphHeight, y0: line.box.y0 - 2, x1: line.box.x1 + glyphHeight, y1: line.box.y1 + 2 });
        }
    }

    const { horizontals, verticals: allVerticals, bridgedGaps } = extractSegments(
        lineArt,
        minHorizontalRun,
        minVerticalRun,
        reach,
        Math.round(1.2 * glyphHeight),
        inkForRuns,
        glyphHeight,
        textRows,
        parameters.gapInkShare,
    );
    // A sliver a few pixels wide and tall beside a vertical is its rounded end or a stray edge,
    // and would take the attachment of a branch that belongs to the vertical.
    const verticals = new Array<Segment>();

    for (const segment of allVerticals)
    {
        const width = segment.box.x1 - segment.box.x0;
        const height = segment.box.y1 - segment.box.y0;

        if (width > thickness / 3 || height > 3 * thickness)
        {
            verticals.push(segment);
        }
    }

    const chartStrips: ChartStripFind = parameters.chartStrips ? removeChartStrips(horizontals, verticals, image.width, image.height, glyphHeight, thickness) : { issues: [], axisRules: [], axisTicks: [] };
    const frameIssues = [...removeFrameSegments(horizontals, image.width, image.height), ...removeFrameSegments(verticals, image.width, image.height), ...chartStrips.issues, ...removeChartLines(horizontals, verticals, image.width, image.height)];
    // Steps between successive nodes of a pectinate tree can be shorter than the shortest run
    // that counts as a line; the ink between two close verticals supplies the missing branch.
    const connectors = new Set<string>();

    if (parameters.shortConnectors)
    {
        for (const connector of findShortConnectors(lineInk, verticals, horizontals, minHorizontalRun, thickness, horizontals.length + 1))
        {
            horizontals.push(connector);
            connectors.add(connector.id);
        }
    }

    recordLap("segments");
    announce("Tracing the tree");

    // A branch end sits within about one line width of its vertical; anything looser lets a
    // tip's branch reach the wrong node.
    const tolerance = parameters.attachTolerance ?? Math.max(3, Math.round(thickness) + 2);
    const labelBoxes = new Array<Box>();

    for (const line of roughLines)
    {
        labelBoxes.push(line.box);
    }

    // A slanted figure is read from the skeleton of its line art instead of from segments; the
    // rough text rows tell its root stub, which ends in nothing, from leaders, which end at text.
    const roughBoxes = new Array<Box>();

    for (const line of roughLines)
    {
        roughBoxes.push(line.box);
    }

    // Filled triangles at the tips of a slanted figure read as glyphs and leave the line art;
    // the fat shapes of the text ink at the tip line are what the tips' stubs run into. A first
    // trace without them finds the tip line, so that bold text inside the tree does not pass
    // for a marker.
    const tipMarkers = slantedFigure ? keepShapesBeyond(findFatShapes(subtractMask(textInk, lineInk), Math.max(2, Math.round(thickness / 5))), traceSlantedTree(lineInk, thickness, glyphHeight, roughBoxes).result.tips, 2 * glyphHeight) : null;
    const slantedTrace = slantedFigure ? traceSlantedTree(lineInk, thickness, glyphHeight, roughBoxes, tipMarkers) : null;
    const trace = slantedTrace === null ? traceRectangularTree(horizontals, verticals, tolerance, reach, labelBoxes, 3 * glyphHeight, labelRows, 1.5 * glyphHeight, connectors) : slantedTrace.result;
    recordLap("trace");
    announce("Finding labels");

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
    const lineArtMask = slantedTrace === null
        ? dilate(createMaskFromBoxes(lineArtBoxes, image.width, image.height), 1)
        : dilate(slantedTrace.skeleton, Math.max(1, Math.round(thickness / 2) + 1));
    const text = detectTextLines(textInk, { lineArtMask, minY: parameters.textMinY });

    // Labels set at a slant are found again in a level frame of their own; the level rows in
    // that zone, fragments of the same labels, give way to them.
    const slanted = parameters.slantedLabels ? detectSlantedLabels(textInk, lineArtMask, trace.tips, glyphHeight, (parameters.minLabelSlant * Math.PI) / 180) : null;
    const textLines = slanted === null ? text.lines : replaceZoneLines(text.lines, slanted);
    const slantIssues = new Array<QcIssue>();

    if (slanted !== null)
    {
        const degrees = Math.round((slanted.measure.angle * 180) / Math.PI);
        slantIssues.push({ severity: "info", code: "labels-slanted", message: `tip labels run at ${degrees} degrees (${slanted.measure.pairs} letter pairs, ${Math.round(100 * slanted.measure.share)}% agreeing); ${slanted.lines.length} row(s) found in a level frame of the label zone`, subject: null });
    }

    recordLap("text");

    const document: ExtractionDocument = {
        version: 1,
        image: { width: fullWidth, height: fullHeight, source: options.source ?? null, region, quarterTurns },
        horizontals,
        verticals,
        textLines,
        nodes: trace.nodes,
        tips: trace.tips,
        root: trace.root,
        qc: [...orientationIssues, ...frameIssues, ...trace.issues, ...slantIssues],
        rejectedVerticals: trace.rejected,
        branches: trace.branches,
        glyphHeight: text.glyphHeight,
        profile: createEmptyProfile(),
        timings,
    };

    // One of the chart's rules carries the ages; they return for the axis reader now that the
    // tracer has had the segments without them.
    horizontals.push(...chartStrips.axisRules);
    verticals.push(...chartStrips.axisTicks);

    // A tip whose branch runs into a solid shape (a collapsed-clade wedge) or a colored marker
    // (a range oval) ends on the far side of it, where its label is.
    if (parameters.extendThroughShapes)
    {
        // A marker is no taller than a label row; its length is a range in time and can be as
        // long as the figure.
        const maxWidth = Infinity;
        const maxHeight = 2.5 * glyphHeight;
        extendTipsThroughMarkers(document, keepSmallShapes(findFatShapes(lineInk, Math.max(parameters.markerRadius, Math.round(thickness) + 1)), maxWidth, maxHeight), thickness, 2);
        extendTipsThroughMarkers(document, keepSmallShapes(markers, maxWidth, maxHeight), thickness, glyphHeight);

        if (parameters.paleMarkers)
        {
            extendTipsThroughMarkers(document, keepSmallShapes(paleMarkers, maxWidth, maxHeight), thickness, glyphHeight, 4 * glyphHeight);
        }

        if (tipMarkers !== null)
        {
            extendTipsThroughMarkers(document, keepSmallShapes(tipMarkers, maxWidth, maxHeight), thickness, 3);
        }
    }

    assignLabels(document);

    // A slanted tree's spurs were pruned on the skeleton, and its labels pair less surely
    // (slanted text, tips at every depth), so an unlabelled tip is not debris there.
    if (slantedTrace === null && parameters.dropDebris)
    {
        removeDebrisTips(document, 3 * glyphHeight, glyphHeight);
    }

    // Clade brackets, axes and legends trace into small pieces beside the tree; they go now,
    // before any label of theirs is read.
    document.qc.push(...pruneDecorations(document));

    if (chooseRoot(document))
    {
        document.qc.push({ severity: "info", code: "root-changed", message: `the main tree is now ${document.root ?? ""}, the piece with the most tips once debris and decorations were removed`, subject: document.root });
    }

    recordLap("assign");

    // The profile is measured before labels are read, since reading them uses it (how far to
    // condense the crops); the parts that the read text can change are measured again after.
    document.profile = measureProfile({ image, textInk, lineInk, glyphMask, glyphHeight, thickness, fragmented, widened, bridgedGaps, document });
    document.profile.orientation = orientation;

    if (slantedTrace !== null)
    {
        document.profile.layout = "slanted";
        document.profile.confidence.layout = 1;
    }

    applyProfileOverrides(document.profile, parameters.profileOverrides);
    // When the tips end on one line, a label row at that line with no tip is a missed branch;
    // it is looked for in the line ink and added before labels are read.
    document.qc.push(...recoverAlignedTips(document, lineInk, thickness, minHorizontalRun));
    document.qc.push(...dropAxisTips(document, glyphHeight));

    if (slantedTrace !== null)
    {
        document.qc.push(...dropTipsBehindLine(document, glyphHeight));
    }

    recordLap("profile");

    if (options.ocr)
    {
        const erased = paintMask(gray, lineArtMask, 255);
        // Large letters need no upscaling for Tesseract and cost it time in proportion to their
        // area, so the scale brings letters to about the target height and no further.
        const ocrScale = Math.min(parameters.ocrScale, Math.max(1, parameters.ocrGlyphTarget / glyphHeight));
        await readLabels(document, erased, options.ocr, ocrScale, names, knownNames, progress);
        // A slanted figure's leader lines to bracketed numbers run the tips' way and read as
        // numbers; they are debris whatever their length.
        removeNumericDebrisTips(document, slantedTrace === null ? 3 * glyphHeight : Infinity, slantedTrace === null && parameters.dropDebris ? 3 * glyphHeight : 0);

        // Reading the labels can turn a piece's tips into debris, and says which piece is the
        // tree; the main tree is chosen again, by named tips first.
        if (chooseRoot(document, true))
        {
            document.qc.push({ severity: "info", code: "root-changed", message: `the main tree is now ${document.root ?? ""}, the piece with the most tips once labels were read`, subject: document.root });
        }

        assignLeftoverNames(document, names);
        measureTextMarks(document.profile, document, textInk, glyphHeight);

        if (document.profile.timeScaled.axis !== null)
        {
            document.profile.timeScaled.calibration = await calibrateAxis(document, textInk, gray, options.ocr, glyphHeight, thickness);

            if (document.profile.timeScaled.calibration !== null)
            {
                document.qc.push(...assignAges(document, document.profile.timeScaled.calibration));
            }
        }

        recordLap("ocr");
    }

    document.qc.push(...checkTipAlignment(document));
    runQualityChecks(document);

    if (region !== null)
    {
        translateDocument(document, region.x0, region.y0);
    }

    return document;
}
