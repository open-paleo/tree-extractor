/**
 * Which way a tree figure stands. The pipeline traces trees with the root on the left and the
 * tips on the right. A tree drawn with its root at the bottom (or top) has its branches as
 * verticals and its labels standing on end or set at an angle; turned a quarter, it is an
 * ordinary tree, so orientation is decided first and the image turned before anything else.
 *
 * The decision comes from where the branches end. A branch ends free at a tip, and the tip's
 * label sits just past that end: to the right in a root-left tree, above it in a root-bottom
 * tree, below it in a root-top tree. A junction end has a long run of the other direction
 * beside it and is not free. Counting free ends with ink past them, by direction, says which
 * way the tips point, whatever the labels' slant; a figure whose labels are not in the image
 * stays undecided, and so does a slanted tree, whose line art is mostly outside long runs.
 */

import type { Mask, Orientation, RgbaImage } from "./types.ts";
import { createDarkMask, createDirectionalRunMask, createLongRunMask, dilate, findConnectedComponents, subtractMask, transposeMask, unionMask } from "./raster.ts";
import { detectTextLines } from "./text-lines.ts";
import { findEndSide } from "./slanted.ts";

/**
 * What the orientation was decided from.
 */
export type OrientationFind = {
    /**
     * The decision.
     */
    orientation: Orientation;

    /**
     * Free right ends of horizontal runs with ink past them.
     */
    rightEnds: number;

    /**
     * Free top ends of vertical runs with ink past them.
     */
    topEnds: number;

    /**
     * Free bottom ends of vertical runs with ink past them.
     */
    bottomEnds: number;

    /**
     * Glyph height the windows were sized from.
     */
    glyphHeight: number;

    /**
     * Glyphs in level text rows lying beyond the right-hand ends of the horizontal runs: the
     * tip labels of a root-left tree, which veto a turn.
     */
    levelLabelGlyphs: number;

    /**
     * Share of the large line art lying in long horizontal or vertical runs; low for a slanted
     * tree.
     */
    runCoverage: number;

    /**
     * True when the line art is mostly outside straight runs: a slanted tree, whose
     * orientation then comes from which side of the lines the text lies on.
     */
    slanted: boolean;
};

/**
 * Free ends of the runs in one direction that have ink past them.
 */
type EndCount = {
    /**
     * Ends toward the run's far side (right, or bottom).
     */
    forward: number;

    /**
     * Ends toward the run's near side (left, or top).
     */
    backward: number;
};

/**
 * Glyph height of the figure's text: whichever reading, upright or on its side, finds more
 * glyphs in long rows decides, and the default stands in when neither finds any.
 *
 * @param textInk - Dark pixels at the text threshold.
 * @returns Glyph height in pixels.
 */
function estimateGlyphHeightEitherWay(textInk: Mask): number
{
    return measureTextEitherWay(textInk).glyphHeight;
}

/**
 * Text measured upright and on its side.
 */
type TextEitherWay = {
    /**
     * Glyph height of whichever reading found more glyphs in long rows.
     */
    glyphHeight: number;

    /**
     * Glyphs in long rows read upright.
     */
    uprightGlyphs: number;

    /**
     * Glyphs in long rows read with the image on its side.
     */
    sidewaysGlyphs: number;
};

/**
 * Measures the figure's text both ways: how many glyphs sit in long rows read upright and
 * read on the side, and the glyph height of the reading that found more.
 *
 * @param textInk - Dark pixels at the text threshold.
 * @returns The measurement.
 */
function measureTextEitherWay(textInk: Mask): TextEitherWay
{
    const upright = detectTextLines(textInk, { lineArtMask: dilate(createLongRunMask(textInk, 28, 20), 1), minY: 0 });
    const transposed = transposeMask(textInk);
    const sideways = detectTextLines(transposed, { lineArtMask: dilate(createLongRunMask(transposed, 28, 20), 1), minY: 0 });
    let uprightGlyphs = 0;
    let sidewaysGlyphs = 0;

    for (const line of upright.lines)
    {
        uprightGlyphs += line.glyphCount >= 5 ? line.glyphCount : 0;
    }

    for (const line of sideways.lines)
    {
        sidewaysGlyphs += line.glyphCount >= 5 ? line.glyphCount : 0;
    }

    const chosen = sidewaysGlyphs > uprightGlyphs ? sideways : upright;

    return { glyphHeight: chosen.glyphHeight > 0 ? chosen.glyphHeight : 12, uprightGlyphs, sidewaysGlyphs };
}

/**
 * Counts ink in a window of a mask, clipped to the mask.
 *
 * @param mask - Mask.
 * @param x0 - Left column.
 * @param y0 - Top row.
 * @param x1 - Right column (exclusive).
 * @param y1 - Bottom row (exclusive).
 * @returns Set pixels in the window.
 */
function countInkInWindow(mask: Mask, x0: number, y0: number, x1: number, y1: number): number
{
    const { width, height, data } = mask;
    const left = Math.max(0, x0);
    const top = Math.max(0, y0);
    const right = Math.min(width, x1);
    const bottom = Math.min(height, y1);
    let count = 0;

    for (let y = top; y < bottom; y++)
    {
        const row = y * width;

        for (let x = left; x < right; x++)
        {
            count += data[row + x];
        }
    }

    return count;
}

/**
 * Counts the free ends of horizontal runs that have loose ink past them: to the right of the
 * right end (forward) or to the left of the left end (backward). An end is free when no long
 * vertical run lies beside it, which is where a junction's connector would be; a range bar's
 * thin outline is not long, so an end inside one is still free.
 *
 * @param runs - Mask of horizontal runs.
 * @param crossRuns - Mask of long runs in the other direction.
 * @param loose - Ink that is not in a long run: text, mostly.
 * @param glyphHeight - Glyph height in pixels.
 * @returns The counts.
 */
function countLabelledEnds(runs: Mask, crossRuns: Mask, loose: Mask, glyphHeight: number): EndCount
{
    const reach = Math.round(4 * glyphHeight);
    const minInk = Math.round(0.2 * glyphHeight * glyphHeight);

    // A label fills a tenth of the window or more; the stray ink of a neighboring row fills
    // less, and a background band fills it edge to edge.
    function hasLooseInk(x0: number, y0: number, x1: number, y1: number): boolean
    {
        const ink = countInkInWindow(loose, x0, y0, x1, y1);
        const area = Math.max(1, (Math.min(loose.width, x1) - Math.max(0, x0)) * (Math.min(loose.height, y1) - Math.max(0, y0)));

        return ink >= minInk && ink >= 0.06 * area && ink <= 0.9 * area;
    }

    // An end is free when no cross run lies within a margin of it, above, below or beyond.
    function isFree(column0: number, column1: number, y0: number, y1: number, margin: number): boolean
    {
        return countInkInWindow(crossRuns, column0, y0 - margin, column1, y1 + margin) === 0;
    }

    const { components } = findConnectedComponents(runs);
    const count: EndCount = { forward: 0, backward: 0 };

    for (const component of components)
    {
        const { x0, y0, x1, y1 } = component.box;
        const margin = Math.max(3, y1 - y0);
        const endColumns = Math.max(2, y1 - y0);

        if (isFree(x1 - endColumns, x1 + margin, y0, y1, margin) && hasLooseInk(x1 + 1, y0 - glyphHeight, x1 + reach, y1 + glyphHeight))
        {
            count.forward++;
        }

        if (isFree(x0 - margin, x0 + endColumns, y0, y1, margin) && hasLooseInk(x0 - reach, y0 - glyphHeight, x0 - 1, y1 + glyphHeight))
        {
            count.backward++;
        }
    }

    return count;
}

/**
 * The large pieces of line ink: branches, bars and frames, but not letters, which are small
 * pieces however the glyph height was judged.
 *
 * @param lineInk - All line ink.
 * @param minSize - Smallest box side of a piece that counts.
 * @returns Mask of the large pieces.
 */
function keepLineArt(lineInk: Mask, minSize: number): Mask
{
    const { components, labels } = findConnectedComponents(lineInk);
    const large = new Uint8Array(components.length + 1);

    for (let index = 0; index < components.length; index++)
    {
        const box = components[index].box;

        if (Math.max(box.x1 - box.x0, box.y1 - box.y0) >= minSize)
        {
            large[index + 1] = 1;
        }
    }

    const data = new Uint8Array(labels.length);

    for (let index = 0; index < labels.length; index++)
    {
        data[index] = labels[index] > 0 ? large[labels[index]] : 0;
    }

    return { width: lineInk.width, height: lineInk.height, data };
}

/**
 * Counts set pixels.
 *
 * @param mask - Mask.
 * @returns Number of set pixels.
 */
function countSet(mask: Mask): number
{
    let count = 0;

    for (let index = 0; index < mask.data.length; index++)
    {
        count += mask.data[index];
    }

    return count;
}

/**
 * Decides which way a figure stands from where its branches end and what lies past the free
 * ends. Vertical runs are counted on the transposed masks, where they are horizontal, so a
 * forward end there is a bottom end and a backward end a top end.
 *
 * @param image - Source image.
 * @param inkThreshold - Luminance below which a pixel is text ink.
 * @param lineThreshold - Luminance below which a neutral pixel is line ink.
 * @param maxChroma - Largest channel spread still neutral.
 * @returns The decision and its evidence.
 */
export function detectOrientation(image: RgbaImage, inkThreshold: number, lineThreshold: number, maxChroma: number): OrientationFind
{
    const lineInk = createDarkMask(image, lineThreshold, true, maxChroma);
    const textInk = createDarkMask(image, inkThreshold, false, maxChroma);
    const text = measureTextEitherWay(textInk);
    const glyphHeight = text.glyphHeight;
    // Twice the glyph height: a letter with an ascender and a descender is shorter than that,
    // so letter strokes are not runs.
    const long = Math.max(12, Math.round(2 * glyphHeight));
    const lineArt = keepLineArt(lineInk, 4 * glyphHeight);
    const horizontalRuns = createDirectionalRunMask(lineArt, long, true);
    const verticalRuns = createDirectionalRunMask(lineArt, long, false);
    // Anything darker than the background and not a long run: labels, but also the range bars
    // and silhouettes a label can sit beyond. The background is usually white, but a figure
    // on a colored ground (a yellow panel, say) would otherwise have ink past every end.
    const anyInk = createDarkMask(image, Math.min(230, measureBackgroundLuminance(image) - 30), false, maxChroma);
    const runs = unionMask(horizontalRuns, verticalRuns);
    const loose = subtractMask(anyInk, dilate(runs, 1));
    const alongRows = countLabelledEnds(horizontalRuns, verticalRuns, loose, glyphHeight);
    const alongColumns = countLabelledEnds(transposeMask(verticalRuns), transposeMask(horizontalRuns), transposeMask(loose), glyphHeight);
    const lineArtPixels = countSet(lineArt);
    const runCoverage = lineArtPixels === 0 ? 1 : countSet(runs) / lineArtPixels;
    const rightEnds = alongRows.forward;
    const topEnds = alongColumns.backward;
    const bottomEnds = alongColumns.forward;
    const standing = Math.max(topEnds, bottomEnds);
    // A dense root-left tree with short terminal branches has node connectors whose ends look
    // free, with the siblings' labels above and below them; its level label rows beyond the
    // branch ends say what it is, and veto a turn, unless the figure has more text standing
    // on its side than level, as a vertical tree with rotated labels and a level axis has.
    const levelLabelGlyphs = text.sidewaysGlyphs > text.uprightGlyphs ? 0 : countLevelLabelGlyphs(textInk, horizontalRuns, glyphHeight);
    let orientation: Orientation = "unknown";
    const slanted = runCoverage < 0.3;

    if (slanted)
    {
        // A slanted tree's ends are its tips, all but the root, so the side of the line art its
        // ends lie on is the tip side.
        orientation = decideFromEndSide(lineArt);
    }
    else if (rightEnds >= 3 && rightEnds >= 2 * standing)
    {
        orientation = "root-left";
    }
    else if (standing >= 3 && standing >= 2 * rightEnds && !(levelLabelGlyphs >= 40 && levelLabelGlyphs >= 3 * standing))
    {
        orientation = topEnds >= bottomEnds ? "root-bottom" : "root-top";
    }

    return { orientation, rightEnds, topEnds, bottomEnds, levelLabelGlyphs, glyphHeight, runCoverage, slanted };
}

/**
 * Counts the glyphs of long level text rows that begin beyond the right-hand ends of the
 * horizontal runs, where a root-left tree's tip labels are, when there are at least eight such
 * rows: a column of labels.
 *
 * @param textInk - Dark pixels at the text threshold.
 * @param horizontalRuns - Mask of long horizontal runs.
 * @param glyphHeight - Glyph height in pixels.
 * @returns Glyphs in such rows.
 */
function countLevelLabelGlyphs(textInk: Mask, horizontalRuns: Mask, glyphHeight: number): number
{
    // The tip line: the column, to a glyph, that the most right-hand ends of long runs share.
    const { components } = findConnectedComponents(horizontalRuns);
    const bins = new Map<number, number>();
    let bestBin = -1;
    let bestCount = 0;

    for (const component of components)
    {
        const bin = Math.floor(component.box.x1 / glyphHeight);
        const count = (bins.get(bin) ?? 0) + 1;
        bins.set(bin, count);

        if (count > bestCount)
        {
            bestCount = count;
            bestBin = bin;
        }
    }

    if (bestCount < 3)
    {
        return 0;
    }

    const tipLine = (bestBin + 0.5) * glyphHeight;
    const strip = dilate(createLongRunMask(textInk, 28, 20), 1);
    const detection = detectTextLines(textInk, { lineArtMask: strip, minY: 0 });
    let glyphs = 0;
    let rows = 0;

    for (const line of detection.lines)
    {
        if (line.glyphCount >= 5 && line.box.x0 >= tipLine - 2 * glyphHeight && line.box.x0 <= tipLine + 6 * glyphHeight)
        {
            glyphs += line.glyphCount;
            rows++;
        }
    }

    // A column of labels, not a few clade names or axis values that happen to start there.
    return rows >= 8 ? glyphs : 0;
}

/**
 * Decides the orientation from which side of the line art its ends lie on: ends to the right
 * mean tips on the right, ends above mean tips above and the root below, and so on.
 *
 * @param lineArt - Large pieces of line ink.
 * @returns The orientation, or unknown when the ends are not to one side.
 */
function decideFromEndSide(lineArt: Mask): Orientation
{
    const side = findEndSide(lineArt);

    if (side === null)
    {
        return "unknown";
    }

    if (side.x > 0)
    {
        return "root-left";
    }

    if (side.y < 0)
    {
        return "root-bottom";
    }

    if (side.y > 0)
    {
        return "root-top";
    }

    return "unknown";
}

/**
 * The most common luminance of the image, sampled, which is the background's.
 *
 * @param image - Source image.
 * @returns A luminance from 0 to 255.
 */
function measureBackgroundLuminance(image: RgbaImage): number
{
    const counts = new Uint32Array(256);
    const step = Math.max(1, Math.floor(Math.sqrt((image.width * image.height) / 200000)));

    for (let y = 0; y < image.height; y += step)
    {
        for (let x = 0; x < image.width; x += step)
        {
            const index = (y * image.width + x) * 4;
            const luminance = Math.round(0.299 * image.data[index] + 0.587 * image.data[index + 1] + 0.114 * image.data[index + 2]);
            counts[luminance]++;
        }
    }

    let best = 255;

    for (let value = 0; value < 256; value++)
    {
        if (counts[value] > counts[best])
        {
            best = value;
        }
    }

    return best;
}
