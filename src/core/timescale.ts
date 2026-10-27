/**
 * Time axes: finding the axis of a time-scaled figure from its tick marks, reading the numbers
 * along it, and fitting the line that turns a pixel column into an age. The calibration is
 * recorded in the profile; what uses it (branch lengths in time) comes after.
 */

import type { AxisCalibration, Box, ExtractionDocument, GrayImage, Mask, OcrEngine, QcIssue, Segment } from "./types.ts";
import { compareNumbers, cropAndScale, findConnectedComponents, rotateGrayQuarter } from "./raster.ts";

/**
 * An axis located by its ticks.
 */
export type AxisFind = {
    /**
     * Row of the axis line.
     */
    y: number;

    /**
     * Columns of the tick marks on the preferred side, left to right.
     */
    ticks: Array<number>;

    /**
     * Columns of the tick-like marks on the other side, which the labels may turn out to be on.
     */
    otherTicks: Array<number>;

    /**
     * Whether the preferred ticks hang below the line rather than rise above it.
     */
    ticksBelow: boolean;

    /**
     * First row of the line's ink.
     */
    lineTop: number;

    /**
     * Row after the last of the line's ink.
     */
    lineBottom: number;

    /**
     * Whether a line of ink runs along the row; a row of tick ends has none.
     */
    hasLine: boolean;

    /**
     * Box covering the line between the outermost ticks.
     */
    box: Box;
};

/**
 * A point on the axis with a value read from its label.
 */
export type AxisPoint = {
    /**
     * Column of the tick.
     */
    x: number;

    /**
     * Value read.
     */
    value: number;
};

/**
 * A candidate row for the axis line, with the ticks counted on each side.
 */
type AxisCandidate = {
    /**
     * Row.
     */
    y: number;

    /**
     * Left bound of the search.
     */
    x0: number;

    /**
     * Right bound of the search.
     */
    x1: number;

    /**
     * First row of the line's ink, once refined.
     */
    lineTop: number;

    /**
     * Row after the last of the line's ink, once refined.
     */
    lineBottom: number;

    /**
     * Whether a line of ink was found at the row, as opposed to a row of tick ends.
     */
    hasLine: boolean;
};

/**
 * Finds the rows of the line itself near a rough candidate row: a segment's box can be taller
 * than its line where glyphs touch it, and a row of tick ends is beside the line, not on it.
 * The dense rows (at least six tenths of the densest) within two clearances of the rough row
 * are the line; without any, the rough row with one clearance either side.
 *
 * @param textInk - Dark pixels at the text threshold.
 * @param rough - Rough candidate.
 * @param clearance - Half-thickness allowance.
 * @returns The candidate with its line rows.
 */
function refineLineRows(textInk: Mask, rough: AxisCandidate, clearance: number): AxisCandidate
{
    const first = Math.max(0, rough.y - 2 * clearance);
    const last = Math.min(textInk.height - 1, rough.y + 2 * clearance);
    const counts = new Array<number>();
    let densest = 0;

    for (let y = first; y <= last; y++)
    {
        let count = 0;

        for (let x = Math.max(0, rough.x0); x < Math.min(textInk.width, rough.x1); x++)
        {
            count += textInk.data[y * textInk.width + x];
        }

        counts.push(count);
        densest = Math.max(densest, count);
    }

    const span = rough.x1 - rough.x0;

    if (densest < 0.5 * span)
    {
        return { ...rough, lineTop: rough.y - clearance, lineBottom: rough.y + clearance + 1, hasLine: false };
    }

    let lineTop = -1;
    let lineBottom = -1;

    for (let index = 0; index < counts.length; index++)
    {
        if (counts[index] >= 0.6 * densest)
        {
            if (lineTop < 0)
            {
                lineTop = first + index;
            }

            lineBottom = first + index + 1;
        }
    }

    return { ...rough, y: Math.round((lineTop + lineBottom - 1) / 2), lineTop: lineTop - 1, lineBottom: lineBottom + 1, hasLine: true };
}

/**
 * Rows where the axis line might be: long horizontals near the top or bottom edge, and rows
 * that many short verticals start or end on (tick marks hanging from a line the segment
 * extraction cut up).
 *
 * @param document - Document.
 * @param glyphHeight - Glyph height in pixels.
 * @returns Candidates, best first.
 */
function listAxisCandidates(document: ExtractionDocument, glyphHeight: number): Array<AxisCandidate>
{
    const { width, height } = document.image;
    const region = document.image.region;
    const extentWidth = region === null ? width : region.x1 - region.x0;
    const extentHeight = region === null ? height : region.y1 - region.y0;
    const candidates = new Array<AxisCandidate>();

    for (const segment of document.horizontals)
    {
        const { box } = segment;
        const nearEdge = box.y0 < 0.15 * extentHeight || box.y1 > 0.85 * extentHeight;

        if (box.x1 - box.x0 >= 0.4 * extentWidth && nearEdge)
        {
            candidates.push({ y: Math.round((box.y0 + box.y1) / 2), x0: box.x0, x1: box.x1, lineTop: box.y0, lineBottom: box.y1, hasLine: true });
        }
    }

    const bin = Math.max(3, Math.round(glyphHeight / 4));
    const counts = new Map<number, Array<Segment>>();

    for (const segment of document.verticals)
    {
        const { box } = segment;

        if (box.y1 - box.y0 > 3 * glyphHeight)
        {
            continue;
        }

        for (const end of [box.y0, box.y1])
        {
            const key = Math.round(end / bin);
            const members = counts.get(key) ?? [];
            members.push(segment);
            counts.set(key, members);
        }
    }

    for (const [key, members] of counts)
    {
        if (members.length < 5)
        {
            continue;
        }

        let x0 = Infinity;
        let x1 = -Infinity;

        for (const segment of members)
        {
            x0 = Math.min(x0, segment.box.x0);
            x1 = Math.max(x1, segment.box.x1);
        }

        if (x1 - x0 >= 0.3 * extentWidth)
        {
            candidates.push({ y: key * bin, x0, x1, lineTop: key * bin, lineBottom: key * bin + 1, hasLine: false });
        }
    }

    return candidates;
}

/**
 * Columns within a range where ink in a band of rows is tall enough to be a tick mark and
 * narrow enough not to be a label.
 *
 * @param ink - Dark pixels.
 * @param x0 - First column.
 * @param x1 - Column after the last.
 * @param top - First row of the band.
 * @param bottom - Row after the last.
 * @param minHeight - Shortest ink column that counts.
 * @param maxWidth - Widest run of such columns that counts.
 * @returns Tick centers, left to right.
 */
function findTicksInBand(ink: Mask, x0: number, x1: number, top: number, bottom: number, minHeight: number, maxWidth: number): Array<number>
{
    const ticks = new Array<number>();
    const first = Math.max(0, top);
    const last = Math.min(ink.height, bottom);
    let runStart = -1;

    for (let x = Math.max(0, x0); x <= Math.min(ink.width, x1); x++)
    {
        let count = 0;

        if (x < Math.min(ink.width, x1))
        {
            for (let y = first; y < last; y++)
            {
                count += ink.data[y * ink.width + x];
            }
        }

        if (count >= minHeight)
        {
            if (runStart < 0)
            {
                runStart = x;
            }
        }
        else if (runStart >= 0)
        {
            if (x - runStart <= maxWidth)
            {
                ticks.push((runStart + x - 1) / 2);
            }

            runStart = -1;
        }
    }

    return ticks;
}

/**
 * Axis candidates with their ticks, those with a line of ink first, then nearest the top or
 * bottom edge. A time axis sits at
 * the edge of the figure with nothing but its labels beyond it, which a branch line that
 * happens to be long and high up does not; the labels, read later, settle the choice.
 *
 * @param document - Document.
 * @param textInk - Dark pixels at the text threshold.
 * @param glyphHeight - Glyph height in pixels.
 * @param thickness - Line thickness in pixels.
 * @returns Candidates with five or more ticks across a third of the width, best first.
 */
export function rankAxisCandidates(document: ExtractionDocument, textInk: Mask, glyphHeight: number, thickness: number): Array<AxisFind>
{
    const { width, height } = document.image;
    const region = document.image.region;
    const extentWidth = region === null ? width : region.x1 - region.x0;
    const extentHeight = region === null ? height : region.y1 - region.y0;
    // Ticks are read in the glyph height nearest the line; the labels start beyond that.
    const bandDepth = Math.round(glyphHeight);
    const minHeight = Math.round(0.4 * glyphHeight);
    const maxWidth = Math.max(3, Math.round(thickness) + 2);
    const clearance = Math.max(2, Math.round(thickness) + 1);
    const found = new Array<AxisFind>();
    const seenRows = new Set<number>();

    for (const rough of listAxisCandidates(document, glyphHeight))
    {
        const candidate = refineLineRows(textInk, rough, clearance);
        const rowKey = Math.round(candidate.y / Math.max(3, clearance));

        if (seenRows.has(rowKey))
        {
            continue;
        }

        const below = findTicksInBand(textInk, candidate.x0, candidate.x1, candidate.lineBottom, candidate.lineBottom + bandDepth, minHeight, maxWidth);
        const above = findTicksInBand(textInk, candidate.x0, candidate.x1, candidate.lineTop - bandDepth, candidate.lineTop, minHeight, maxWidth);
        const ticksBelow = below.length >= above.length;
        const ticks = ticksBelow ? below : above;

        if (ticks.length < 5 || ticks[ticks.length - 1] - ticks[0] < 0.3 * extentWidth)
        {
            continue;
        }

        seenRows.add(rowKey);
        found.push({
            y: candidate.y,
            ticks,
            otherTicks: ticksBelow ? above : below,
            ticksBelow,
            lineTop: candidate.lineTop,
            lineBottom: candidate.lineBottom,
            hasLine: candidate.hasLine,
            box: { x0: Math.floor(ticks[0]), y0: candidate.lineTop, x1: Math.ceil(ticks[ticks.length - 1]), y1: candidate.lineBottom },
        });
    }

    // Rows with a line of ink first (a row of tick ends is beside the axis, not on it), then
    // nearest the edge.
    function compareEdgeDistance(left: AxisFind, right: AxisFind): number
    {
        if (left.hasLine !== right.hasLine)
        {
            return left.hasLine ? -1 : 1;
        }

        return Math.min(left.y, extentHeight - left.y) - Math.min(right.y, extentHeight - right.y);
    }

    found.sort(compareEdgeDistance);

    return found;
}

/**
 * The most likely time axis before any label is read: the candidate nearest an edge.
 *
 * @param document - Document.
 * @param textInk - Dark pixels at the text threshold.
 * @param glyphHeight - Glyph height in pixels.
 * @param thickness - Line thickness in pixels.
 * @returns The axis, or null when there is no candidate.
 */
export function findAxis(document: ExtractionDocument, textInk: Mask, glyphHeight: number, thickness: number): AxisFind | null
{
    const ranked = rankAxisCandidates(document, textInk, glyphHeight, thickness);

    return ranked.length === 0 ? null : ranked[0];
}

/**
 * The rows around an axis in which its labels are looked for, and what is blanked in them.
 */
type LabelBand = {
    /**
     * First row.
     */
    top: number;

    /**
     * Row after the last.
     */
    bottom: number;

    /**
     * First row of the axis line.
     */
    lineTop: number;

    /**
     * Row after the last of the axis line.
     */
    lineBottom: number;

    /**
     * First row of the tick band.
     */
    tickTop: number;

    /**
     * Row after the last of the tick band.
     */
    tickBottom: number;
};

/**
 * Lays out the label band for one side of an axis: from a glyph and a half on the far side of
 * the line (a number written along its tick can start there) to seven glyphs on the near side.
 *
 * @param axis - The axis.
 * @param below - Whether the labels are below the line.
 * @param glyphHeight - Glyph height in pixels.
 * @param height - Image height.
 * @returns The band.
 */
export function layOutLabelBand(axis: AxisFind, below: boolean, glyphHeight: number, height: number): LabelBand
{
    const far = Math.round(1.5 * glyphHeight);
    const near = Math.round(7 * glyphHeight);
    const tickDepth = Math.round(glyphHeight);

    return {
        top: Math.max(0, below ? axis.lineTop - far : axis.lineTop - near),
        bottom: Math.min(height, below ? axis.lineBottom + near : axis.lineBottom + far),
        lineTop: axis.lineTop,
        lineBottom: axis.lineBottom,
        tickTop: below ? axis.lineBottom : axis.lineTop - tickDepth,
        tickBottom: below ? axis.lineBottom + tickDepth : axis.lineTop,
    };
}

/**
 * Boxes of the labels along one side of an axis: stacks of glyphs standing on end (numbers
 * written along the ticks) and ordinary short rows. The axis line's rows and the tick marks
 * are blanked first, so that a number straddling the line, or touching its tick, comes out as
 * one stack.
 *
 * @param document - Document, for its text rows.
 * @param textInk - Dark pixels at the text threshold.
 * @param axis - The axis.
 * @param below - Whether to look below the line rather than above it.
 * @param ticks - Tick columns on that side.
 * @param glyphHeight - Glyph height in pixels.
 * @returns Label boxes, left to right.
 */
export function findAxisLabelBoxes(document: ExtractionDocument, textInk: Mask, axis: AxisFind, below: boolean, ticks: Array<number>, glyphHeight: number): Array<Box>
{
    const band = layOutLabelBand(axis, below, glyphHeight, textInk.height);
    const { top, bottom } = band;
    const cut = cutRows(textInk, top, bottom);
    blankLineAndTicks(cut, -top, band, ticks);
    const { components } = findConnectedComponents(cut);
    const glyphs = new Array<Box>();

    for (const component of components)
    {
        const box = component.box;
        const boxWidth = box.x1 - box.x0;
        const boxHeight = box.y1 - box.y0;

        // A digit on its side is about a glyph high and a bit less wide; a tick is far thinner.
        if (boxWidth >= 0.3 * glyphHeight && boxWidth <= 1.6 * glyphHeight && boxHeight >= 0.3 * glyphHeight && boxHeight <= 1.8 * glyphHeight)
        {
            glyphs.push({ x0: box.x0, y0: box.y0 + top, x1: box.x1, y1: box.y1 + top });
        }
    }

    glyphs.sort(compareBoxTops);
    const stacks = new Array<Box>();
    const stackGap = Math.max(0.8 * glyphHeight, band.lineBottom - band.lineTop + 2);

    // Glyphs whose columns overlap and that sit close to one another vertically are one number
    // written along the tick; the gap allows for a decimal point too small to be a glyph, and
    // for the blanked rows of the line.
    for (const glyph of glyphs)
    {
        let joined = false;

        for (const stack of stacks)
        {
            const overlap = Math.min(stack.x1, glyph.x1) - Math.max(stack.x0, glyph.x0);

            if (overlap > 0 && glyph.y0 - stack.y1 <= stackGap && glyph.y0 >= stack.y0)
            {
                stack.x0 = Math.min(stack.x0, glyph.x0);
                stack.x1 = Math.max(stack.x1, glyph.x1);
                stack.y1 = Math.max(stack.y1, glyph.y1);
                joined = true;
                break;
            }
        }

        if (!joined)
        {
            stacks.push({ x0: glyph.x0, y0: glyph.y0, x1: glyph.x1, y1: glyph.y1 });
        }
    }

    // Stacks that share columns and touch or overlap vertically are one number read in parts.
    let merged = true;

    while (merged)
    {
        merged = false;

        for (let index = 0; index < stacks.length && !merged; index++)
        {
            for (let other = index + 1; other < stacks.length; other++)
            {
                const first = stacks[index];
                const second = stacks[other];
                const overlap = Math.min(first.x1, second.x1) - Math.max(first.x0, second.x0);
                const narrower = Math.min(first.x1 - first.x0, second.x1 - second.x0);
                const verticalGap = Math.max(second.y0 - first.y1, first.y0 - second.y1);

                if (overlap >= 0.5 * narrower && verticalGap <= stackGap)
                {
                    first.x0 = Math.min(first.x0, second.x0);
                    first.x1 = Math.max(first.x1, second.x1);
                    first.y0 = Math.min(first.y0, second.y0);
                    first.y1 = Math.max(first.y1, second.y1);
                    stacks.splice(other, 1);
                    merged = true;
                    break;
                }
            }
        }
    }

    const boxes = new Array<Box>();

    for (const stack of stacks)
    {
        if (stack.y1 - stack.y0 >= 1.2 * glyphHeight)
        {
            boxes.push(stack);
        }
    }

    // Short upright rows in the band are labels too, unless a stack already covers them (a
    // number on its side is also detected as a row of one or two glyphs).
    for (const line of document.textLines)
    {
        const { box } = line;
        const inBand = box.y0 >= top && box.y1 <= bottom && box.x0 >= axis.box.x0 - glyphHeight && box.x1 <= axis.box.x1 + glyphHeight;

        if (!inBand || line.glyphCount > 6 || box.x1 - box.x0 > 6 * glyphHeight)
        {
            continue;
        }

        let covered = false;

        for (const stack of boxes)
        {
            const overlapX = Math.min(stack.x1, box.x1) - Math.max(stack.x0, box.x0);
            const overlapY = Math.min(stack.y1, box.y1) - Math.max(stack.y0, box.y0);

            if (overlapX > 0 && overlapY > 0)
            {
                covered = true;
                break;
            }
        }

        if (!covered)
        {
            boxes.push({ x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 });
        }
    }

    boxes.sort(compareBoxLefts);

    return boxes;
}

/**
 * Blanks the axis line's rows and the tick marks (two pixels either side of each tick column,
 * within the tick band) in a mask, with its rows offset from the image's.
 *
 * @param mask - Mask modified in place; a byte mask or a luminance image.
 * @param offsetY - What to add to an image row to get the mask row.
 * @param band - The label band.
 * @param ticks - Tick columns.
 * @param scale - Pixels per image pixel in the mask.
 * @param offsetX - What to add to an image column to get the mask column, before scaling.
 * @param blank - Value that means empty.
 */
function blankLineAndTicks(mask: Mask | GrayImage, offsetY: number, band: LabelBand, ticks: Array<number>, scale = 1, offsetX = 0, blank = 0): void
{
    const { width, height, data } = mask;

    for (let y = Math.max(0, (band.lineTop + offsetY) * scale); y < Math.min(height, (band.lineBottom + offsetY) * scale); y++)
    {
        data.fill(blank, y * width, (y + 1) * width);
    }

    for (let y = Math.max(0, (band.tickTop + offsetY) * scale); y < Math.min(height, (band.tickBottom + offsetY) * scale); y++)
    {
        for (const tick of ticks)
        {
            const x0 = Math.max(0, Math.floor((tick + offsetX - 2) * scale));
            const x1 = Math.min(width, Math.ceil((tick + offsetX + 3) * scale));

            if (x1 > x0)
            {
                data.fill(blank, y * width + x0, y * width + x1);
            }
        }
    }
}

/**
 * Copies a range of rows of a mask into a mask of its own.
 *
 * @param mask - Source mask.
 * @param top - First row.
 * @param bottom - Row after the last.
 * @returns The rows as a mask.
 */
function cutRows(mask: Mask, top: number, bottom: number): Mask
{
    const first = Math.max(0, Math.min(mask.height, top));
    const last = Math.max(first, Math.min(mask.height, bottom));
    const data = new Uint8Array(mask.width * (last - first));
    data.set(mask.data.subarray(first * mask.width, last * mask.width));

    return { width: mask.width, height: last - first, data };
}

/**
 * Orders boxes by top edge.
 *
 * @param left - First box.
 * @param right - Second box.
 * @returns Negative when left is higher.
 */
function compareBoxTops(left: Box, right: Box): number
{
    return left.y0 - right.y0;
}

/**
 * Orders boxes by left edge.
 *
 * @param left - First box.
 * @param right - Second box.
 * @returns Negative when left is further left.
 */
function compareBoxLefts(left: Box, right: Box): number
{
    return left.x0 - right.x0;
}

/**
 * Turns OCR output into a number, forgiving the usual digit confusions.
 *
 * @param text - Recognized text.
 * @returns The number, or null when the text is not one.
 */
export function parseAxisNumber(text: string): number | null
{
    // Only the confusions that leave a digit string are forgiven; anything else in the read
    // means it was not a number, or not read the right way up.
    const cleaned = text.trim().replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").replace(/,/g, ".");

    if (!/^-?\d+(\.\d+)?$/.test(cleaned))
    {
        return null;
    }

    return Number(cleaned);
}

/**
 * Least-squares line through the points, as the column at value zero and the columns per unit.
 *
 * @param points - Ticks with values, three or more.
 * @param glyphHeight - Glyph height in pixels, for the residual limit.
 * @returns The calibration, or null when the points do not lie on a line.
 */
export function fitAxisCalibration(points: Array<AxisPoint>, glyphHeight: number): AxisCalibration | null
{
    if (points.length < 3)
    {
        return null;
    }

    let sumV = 0;
    let sumX = 0;
    let sumVV = 0;
    let sumVX = 0;

    for (const point of points)
    {
        sumV += point.value;
        sumX += point.x;
        sumVV += point.value * point.value;
        sumVX += point.value * point.x;
    }

    const count = points.length;
    const denominator = count * sumVV - sumV * sumV;

    if (denominator === 0)
    {
        return null;
    }

    const pixelsPerUnit = (count * sumVX - sumV * sumX) / denominator;
    const originX = (sumX - pixelsPerUnit * sumV) / count;
    let squares = 0;

    for (const point of points)
    {
        const error = originX + pixelsPerUnit * point.value - point.x;
        squares += error * error;
    }

    const residual = Math.sqrt(squares / count);

    if (pixelsPerUnit === 0 || residual > 0.5 * glyphHeight)
    {
        return null;
    }

    return { originX, pixelsPerUnit, points: count, residual };
}

/**
 * Reads the numbers along the axis and fits the calibration; the value of each label goes
 * with the nearest tick. When a fit succeeds the profile's axis box and tick count are
 * replaced by the candidate that produced it.
 *
 * @param document - Document whose profile holds the axis.
 * @param textInk - Dark pixels at the text threshold.
 * @param gray - Luminance image.
 * @param ocr - OCR engine.
 * @param glyphHeight - Glyph height in pixels.
 * @param thickness - Line thickness in pixels.
 * @returns The calibration, or null.
 */
export async function calibrateAxis(document: ExtractionDocument, textInk: Mask, gray: GrayImage, ocr: OcrEngine, glyphHeight: number, thickness: number): Promise<AxisCalibration | null>
{
    // Up to four candidates from the edge inwards. First every candidate with its labels on
    // the side its ticks are on, then the other sides: a row of label bottoms also makes a
    // candidate, and its labels lie on the side without ticks, so the real line wins the first pass.
    // The first whose labels read as numbers on a line is the axis; a branch line never gets
    // that far.
    const candidates = rankAxisCandidates(document, textInk, glyphHeight, thickness).slice(0, 4);

    for (const preferredSide of [true, false])
    {
        for (const axis of candidates)
        {
            const below = preferredSide ? axis.ticksBelow : !axis.ticksBelow;
            const ticks = preferredSide ? axis.ticks : axis.otherTicks;

            if (ticks.length < 3)
            {
                continue;
            }

            const points = await readAxisPoints(document, textInk, gray, ocr, axis, below, ticks, glyphHeight);
            const calibration = fitAxisCalibration(points, glyphHeight);

            if (calibration !== null)
            {
                document.profile.timeScaled.axis = { x0: axis.box.x0, y0: axis.box.y0, x1: axis.box.x1, y1: axis.box.y1 };
                document.profile.timeScaled.ticks = ticks.length;

                return calibration;
            }
        }
    }

    return null;
}

/**
 * One label read in one orientation.
 */
type LabelRead = {
    /**
     * Column of the tick the label belongs to.
     */
    x: number;

    /**
     * Value read, or null.
     */
    value: number | null;

    /**
     * OCR confidence of the read.
     */
    confidence: number;
};

/**
 * Reads the labels on one side of the axis and pairs each with its nearest tick. Labels on
 * their side are read turned a quarter each way, and the way that gives numbers for the most
 * of them (then the more confident reads) is taken for all, since one axis has one direction
 * of writing.
 *
 * @param document - Document.
 * @param textInk - Dark pixels at the text threshold.
 * @param gray - Luminance image.
 * @param ocr - OCR engine.
 * @param axis - The axis.
 * @param below - Which side.
 * @param ticks - Tick columns on that side.
 * @param glyphHeight - Glyph height in pixels.
 * @returns Points, left to right.
 */
export async function readAxisPoints(document: ExtractionDocument, textInk: Mask, gray: GrayImage, ocr: OcrEngine, axis: AxisFind, below: boolean, ticks: Array<number>, glyphHeight: number): Promise<Array<AxisPoint>>
{
    const usedTicks = new Set<number>();
    const boxes = findAxisLabelBoxes(document, textInk, axis, below, ticks, glyphHeight);
    const band = layOutLabelBand(axis, below, glyphHeight, textInk.height);
    const orientations: Array<Array<LabelRead>> = [[], [], []];

    for (const box of boxes)
    {
        const center = (box.x0 + box.x1) / 2;
        let tick = -1;
        let distance = glyphHeight;

        for (const candidate of ticks)
        {
            if (!usedTicks.has(candidate) && Math.abs(candidate - center) < distance)
            {
                tick = candidate;
                distance = Math.abs(candidate - center);
            }
        }

        if (tick < 0)
        {
            continue;
        }

        usedTicks.add(tick);
        const crop = cropAxisLabel(gray, box, band, ticks);
        const tall = box.y1 - box.y0 > 1.5 * (box.x1 - box.x0);
        const attempts = tall ? [null, rotateGrayQuarter(crop, false), rotateGrayQuarter(crop, true)] : [crop, null, null];

        for (let index = 0; index < attempts.length; index++)
        {
            const attempt = attempts[index];

            if (attempt === null)
            {
                continue;
            }

            const result = await ocr.recognize(attempt, "digits");
            orientations[index].push({ x: tick, value: parseAxisNumber(result.text), confidence: result.confidence });
        }
    }

    let best = 0;
    let bestParsed = -1;
    let bestConfidence = -1;

    for (let index = 0; index < orientations.length; index++)
    {
        let parsed = 0;
        let confidence = 0;

        for (const read of orientations[index])
        {
            if (read.value !== null)
            {
                parsed++;
                confidence += read.confidence;
            }
        }

        if (parsed > bestParsed || (parsed === bestParsed && confidence > bestConfidence))
        {
            best = index;
            bestParsed = parsed;
            bestConfidence = confidence;
        }
    }

    const points = new Array<AxisPoint>();

    for (const read of orientations[best])
    {
        if (read.value !== null)
        {
            points.push({ x: read.x, value: read.value });
        }
    }

    points.sort(compareAxisPoints);

    return points;
}

/**
 * Crops a label for OCR, upscaled three times, with the axis line's rows and the tick marks
 * painted white as they were blanked when the label was found.
 *
 * @param gray - Luminance image.
 * @param box - Label box.
 * @param band - The label band.
 * @param ticks - Tick columns.
 * @returns The crop.
 */
export function cropAxisLabel(gray: GrayImage, box: Box, band: LabelBand, ticks: Array<number>): GrayImage
{
    const pad = 3;
    const scale = 3;
    const crop = cropAndScale(gray, box, pad, scale);
    const left = Math.max(0, box.x0 - pad);
    const top = Math.max(0, box.y0 - pad);
    blankLineAndTicks(crop, -top, band, ticks, scale, -left, 255);

    return crop;
}

/**
 * Orders points by column.
 *
 * @param left - First point.
 * @param right - Second point.
 * @returns Negative when left is further left.
 */
function compareAxisPoints(left: AxisPoint, right: AxisPoint): number
{
    return compareNumbers(left.x, right.x);
}

/**
 * Value on the axis at a column.
 *
 * @param calibration - Axis calibration.
 * @param x - Column.
 * @returns The value.
 */
export function computeAxisValue(calibration: AxisCalibration, x: number): number
{
    return (x - calibration.originX) / calibration.pixelsPerUnit;
}

/**
 * Gives every node and tip of the document its age from the calibration: the axis value at its
 * column. A tip that ends in a range bar gets the age of the bar's far end, which is what its
 * column is; the start of the bar is not told apart yet.
 *
 * @param document - Document updated in place.
 * @param calibration - Axis calibration.
 * @returns One informational issue describing the ages, plus a warning when branches run the
 * wrong way in time.
 */
export function assignAges(document: ExtractionDocument, calibration: AxisCalibration): Array<QcIssue>
{
    const nodeById = new Map<string, number>();
    let youngest = Infinity;
    let oldest = -Infinity;

    for (const node of document.nodes)
    {
        node.age = computeAxisValue(calibration, node.x);
        nodeById.set(node.id, node.age);
    }

    for (const tip of document.tips)
    {
        tip.age = computeAxisValue(calibration, tip.x);
        youngest = Math.min(youngest, tip.age);
        oldest = Math.max(oldest, tip.age);
    }

    let reversed = 0;
    const tolerance = Math.abs(1 / calibration.pixelsPerUnit);

    for (const node of document.nodes)
    {
        const parentAge = node.parent === null ? undefined : nodeById.get(node.parent);

        if (parentAge !== undefined && node.age !== null && node.age > parentAge + tolerance)
        {
            reversed++;
        }
    }

    for (const tip of document.tips)
    {
        const parentAge = tip.parent === null ? undefined : nodeById.get(tip.parent);

        if (parentAge !== undefined && tip.age !== null && tip.age > parentAge + tolerance)
        {
            reversed++;
        }
    }

    const issues: Array<QcIssue> = [
        {
            severity: "info",
            code: "ages-assigned",
            message: `ages from the time axis: tips span ${formatAge(youngest)} to ${formatAge(oldest)} axis units; branch lengths are written to the Newick output`,
            subject: null,
        },
    ];

    if (reversed > 0)
    {
        issues.push({
            severity: "warning",
            code: "branch-runs-backward",
            message: `${reversed} branch(es) end older than they start by more than a pixel; their lengths are written as 0`,
            subject: null,
        });
    }

    return issues;
}

/**
 * Formats an age for a message.
 *
 * @param age - Age in axis units.
 * @returns Up to two decimals, no trailing zeros.
 */
function formatAge(age: number): string
{
    return Number.isFinite(age) ? String(Math.round(age * 100) / 100) : "?";
}
