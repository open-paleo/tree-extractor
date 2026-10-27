/**
 * The extraction pipeline: image in, extraction document out. Pure apart from the injected OCR
 * engine, so it runs in Node and in the browser alike.
 */

import type { Box, ExtractionDocument, GrayImage, Mask, OcrEngine, ProfileOverrides, ProgressReporter, QcIssue, RgbaImage, TextLine, Tip, TreeNode } from "./types.ts";
import { applyProfileOverrides, createEmptyProfile, measureProfile, measureTextMarks } from "./profile.ts";
import { checkTipAlignment, recoverAlignedTips } from "./alignment.ts";
import { pruneDecorations } from "./decorations.ts";
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
    subtractMask,
    unionMask,
} from "./raster.ts";
import { detectTextLines } from "./text-lines.ts";
import { extractSegments } from "./segments.ts";
import { traceRectangularTree } from "./tracer.ts";
import { assignLabels, readLabels } from "./labels.ts";
import { getTipDisplayName } from "./newick.ts";
import { normalizeName, scoreName } from "./matching.ts";
import { clampBox, cropImage, translateDocument } from "./geometry.ts";

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
     * Rows above this are ignored by text detection.
     */
    textMinY: number;

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
    textMinY: 0,
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
    const strongInk = createDarkMask(image, parameters.lineThreshold, true, parameters.maxChroma);

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

    return { gray, textInk, lineInk, glyphMask: rough.glyphMask, fragmented, widened, glyphHeight, roughLines: rough.lines };
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
function removeNumericDebrisTips(document: ExtractionDocument, maxLength: number): void
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

        let parentX: number | null = null;

        for (const node of document.nodes)
        {
            if (node.id === tip.parent)
            {
                parentX = node.x;
            }
        }

        if (parentX !== null && tip.x - parentX < maxLength)
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

    removeDebrisTips(document, maxLength, 0);
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
        else if (tip.label !== null)
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

            tip.match = { name: bestName, similarity: bestScore, margin: bestScore - runnerUp, accepted: true };
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
 * @param fullImage - Decoded RGBA image.
 * @param options - OCR engine, name list, region and threshold overrides.
 * @returns The extraction document.
 */
export async function extractTree(fullImage: RgbaImage, options: Partial<ExtractOptions> = {}): Promise<ExtractionDocument>
{
    const region = options.region === undefined || options.region === null ? null : clampBox(options.region, fullImage.width, fullImage.height);

    if (region !== null && (region.x1 - region.x0 < 1 || region.y1 - region.y0 < 1))
    {
        throw new Error("the region to analyze is empty");
    }

    const image = region === null ? fullImage : cropImage(fullImage, region);
    const parameters = { ...defaultParameters, ...options.parameters };
    const names = options.names ?? [];
    const timings: Record<string, number> = {};
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
    const { gray, textInk, lineInk, glyphMask, fragmented, widened, glyphHeight, roughLines } = prepareMasks(image, parameters);
    recordLap("masks");
    announce("Finding segments");

    // The shortest run that counts as a line must exceed the line thickness, or a thick vertical
    // reads as a stack of short horizontal runs and glues every branch it touches into one blob.
    const thickness = estimateLineThickness(lineInk);
    const minHorizontalRun = Math.max(parameters.minHorizontalRun, 2 * thickness);
    const probe = extractSegments(lineInk, minHorizontalRun, Number.MAX_SAFE_INTEGER);
    const thicknesses = new Array<number>();

    for (const segment of probe.horizontals)
    {
        thicknesses.push(segment.box.y1 - segment.box.y0);
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

    const { horizontals, verticals, bridgedGaps } = extractSegments(
        lineInk,
        minHorizontalRun,
        minVerticalRun,
        reach,
        Math.round(1.2 * glyphHeight),
        textInk,
        glyphHeight,
        textRows,
    );
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

    const trace = traceRectangularTree(horizontals, verticals, tolerance, reach, labelBoxes, 3 * glyphHeight, labelRows, 1.5 * glyphHeight);
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
    const lineArtMask = dilate(createMaskFromBoxes(lineArtBoxes, image.width, image.height), 1);
    const text = detectTextLines(textInk, { lineArtMask, minY: parameters.textMinY });
    recordLap("text");

    const document: ExtractionDocument = {
        version: 1,
        image: { width: fullImage.width, height: fullImage.height, source: options.source ?? null, region },
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
        profile: createEmptyProfile(),
        timings,
    };

    assignLabels(document);
    removeDebrisTips(document, 3 * glyphHeight, glyphHeight);
    // Clade brackets, axes and legends trace into small pieces beside the tree; they go now,
    // before any label of theirs is read.
    document.qc.push(...pruneDecorations(document));
    recordLap("assign");

    // The profile is measured before labels are read, since reading them uses it (how far to
    // condense the crops); the parts that the read text can change are measured again after.
    document.profile = measureProfile({ image, textInk, lineInk, glyphMask, glyphHeight, thickness, fragmented, widened, bridgedGaps, document });
    applyProfileOverrides(document.profile, parameters.profileOverrides);
    // When the tips end on one line, a label row at that line with no tip is a missed branch;
    // it is looked for in the line ink and added before labels are read.
    document.qc.push(...recoverAlignedTips(document, lineInk, thickness, minHorizontalRun));
    recordLap("profile");

    if (options.ocr)
    {
        const erased = paintMask(gray, lineArtMask, 255);
        await readLabels(document, erased, options.ocr, parameters.ocrScale, names, progress);
        removeNumericDebrisTips(document, 3 * glyphHeight);
        assignLeftoverNames(document, names);
        measureTextMarks(document.profile, document, textInk, glyphHeight);
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
