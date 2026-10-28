/**
 * Labels set at a slant. Some figures run their tip labels downward at an angle to fit them
 * in, and a tree that was turned a quarter brings labels that stood at sixty or seventy degrees
 * to twenty or thirty off level. A row detector built for level text breaks such a label into
 * fragments. Here the slant is measured from how letters follow one another in the zone where
 * the labels are, and when it is large the zone is turned level into a frame of its own, the
 * rows are found there, and each row keeps its frame so that the tips can be paired with it
 * and its crop read.
 */

import type { Box, GrayImage, Mask, RotatedFrame, TextLine, Tip } from "./types.ts";
import { createRotatedFrame, mapPointFromFrame } from "./geometry.ts";
import { findConnectedComponents, subtractMask } from "./raster.ts";
import { detectTextLines } from "./text-lines.ts";

/**
 * What the slant measurement found.
 */
export type SlantMeasure = {
    /**
     * Slant in radians, positive when the text runs downward to the right.
     */
    angle: number;

    /**
     * Letter pairs the angle was taken from.
     */
    pairs: number;

    /**
     * Share of the pairs that agree with the angle.
     */
    share: number;
};

/**
 * Slanted label rows with their frame.
 */
export type SlantedLabels = {
    /**
     * The frame the rows are measured in.
     */
    frame: RotatedFrame;

    /**
     * The zone of the figure that was turned.
     */
    zone: Box;

    /**
     * Rows found in the frame, with the frame set on each.
     */
    lines: Array<TextLine>;

    /**
     * The measurement that decided it.
     */
    measure: SlantMeasure;
};

/**
 * A glyph center for the pairing.
 */
type GlyphCenter = {
    /**
     * Horizontal center.
     */
    x: number;

    /**
     * Vertical center.
     */
    y: number;
};

/**
 * Orders glyph centers left to right.
 *
 * @param left - First center.
 * @param right - Second center.
 * @returns Negative when left is further left.
 */
function compareCentersByX(left: GlyphCenter, right: GlyphCenter): number
{
    return left.x - right.x;
}

/**
 * Measures the slant of text in a zone from the direction in which letters follow one
 * another: each letter-sized piece of ink is paired with its nearest neighbor to the right, and
 * the angle most pairs agree on is the slant. Level text gives an angle near zero whether or
 * not it is italic.
 *
 * @param residue - Text ink with the line art removed.
 * @param zone - Where to look.
 * @param glyphHeight - Glyph height in pixels.
 * @returns The measurement; pairs is zero when the zone has too little text.
 */
export function measureLabelSlant(residue: Mask, zone: Box, glyphHeight: number): SlantMeasure
{
    const { components } = findConnectedComponents(residue);
    const centers = new Array<GlyphCenter>();

    for (const component of components)
    {
        const { x0, y0, x1, y1 } = component.box;
        const height = y1 - y0;
        const width = x1 - x0;

        if (x0 >= zone.x0 && x1 <= zone.x1 && y0 >= zone.y0 && y1 <= zone.y1
            && component.area >= 6 && height >= 0.3 * glyphHeight && height <= 2 * glyphHeight && width <= 3 * glyphHeight)
        {
            centers.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
        }
    }

    centers.sort(compareCentersByX);
    const minStep = 0.2 * glyphHeight;
    const maxStep = 2.5 * glyphHeight;
    const angles = new Array<number>();

    for (let index = 0; index < centers.length; index++)
    {
        const center = centers[index];
        let bestDistance = Infinity;
        let bestAngle = 0;

        for (let other = index + 1; other < centers.length; other++)
        {
            const candidate = centers[other];
            const dx = candidate.x - center.x;

            if (dx > maxStep)
            {
                break;
            }

            const dy = candidate.y - center.y;

            if (dx < minStep || Math.abs(dy) > maxStep)
            {
                continue;
            }

            const distance = dx * dx + dy * dy;

            if (distance < bestDistance)
            {
                bestDistance = distance;
                bestAngle = Math.atan2(dy, dx);
            }
        }

        if (bestDistance < Infinity)
        {
            angles.push(bestAngle);
        }
    }

    if (angles.length === 0)
    {
        return { angle: 0, pairs: 0, share: 0 };
    }

    // The mode of the angles in three-degree bins, refined to the mean of the angles within
    // a bin and a half of it.
    const binWidth = (3 * Math.PI) / 180;
    const bins = new Map<number, number>();
    let modeBin = 0;
    let modeCount = 0;

    for (const angle of angles)
    {
        const bin = Math.round(angle / binWidth);
        const count = (bins.get(bin) ?? 0) + 1;
        bins.set(bin, count);

        if (count > modeCount)
        {
            modeCount = count;
            modeBin = bin;
        }
    }

    const modeAngle = modeBin * binWidth;
    let sum = 0;
    let agreeing = 0;

    for (const angle of angles)
    {
        if (Math.abs(angle - modeAngle) <= 1.5 * binWidth)
        {
            sum += angle;
            agreeing++;
        }
    }

    return { angle: agreeing === 0 ? 0 : sum / agreeing, pairs: angles.length, share: agreeing / angles.length };
}

/**
 * Turns a zone of a mask into a frame, nearest pixel; pixels outside the zone are clear.
 *
 * @param mask - Source mask.
 * @param zone - Zone of the mask to carry over.
 * @param frame - Target frame.
 * @returns The frame-sized mask.
 */
export function rotateMaskToFrame(mask: Mask, zone: Box, frame: RotatedFrame): Mask
{
    const data = new Uint8Array(frame.width * frame.height);

    for (let y = 0; y < frame.height; y++)
    {
        for (let x = 0; x < frame.width; x++)
        {
            const source = mapPointFromFrame(frame, x + 0.5, y + 0.5);
            const sourceX = Math.floor(source.x);
            const sourceY = Math.floor(source.y);

            if (sourceX >= zone.x0 && sourceX < zone.x1 && sourceY >= zone.y0 && sourceY < zone.y1)
            {
                data[y * frame.width + x] = mask.data[sourceY * mask.width + sourceX];
            }
        }
    }

    return { width: frame.width, height: frame.height, data };
}

/**
 * Turns a luminance image into a frame with bilinear sampling; pixels from outside the image
 * are white.
 *
 * @param image - Source image.
 * @param frame - Target frame.
 * @returns The frame-sized image.
 */
export function rotateGrayToFrame(image: GrayImage, frame: RotatedFrame): GrayImage
{
    const data = new Uint8ClampedArray(frame.width * frame.height);
    data.fill(255);

    for (let y = 0; y < frame.height; y++)
    {
        for (let x = 0; x < frame.width; x++)
        {
            const source = mapPointFromFrame(frame, x + 0.5, y + 0.5);
            const sampleX = source.x - 0.5;
            const sampleY = source.y - 0.5;
            const columnA = Math.floor(sampleX);
            const rowA = Math.floor(sampleY);

            if (columnA < 0 || rowA < 0 || columnA + 1 >= image.width || rowA + 1 >= image.height)
            {
                continue;
            }

            const weightX = sampleX - columnA;
            const weightY = sampleY - rowA;
            const topLeft = image.data[rowA * image.width + columnA];
            const topRight = image.data[rowA * image.width + columnA + 1];
            const bottomLeft = image.data[(rowA + 1) * image.width + columnA];
            const bottomRight = image.data[(rowA + 1) * image.width + columnA + 1];
            const upper = topLeft + (topRight - topLeft) * weightX;
            const lower = bottomLeft + (bottomRight - bottomLeft) * weightX;
            data[y * frame.width + x] = upper + (lower - upper) * weightY;
        }
    }

    return { width: frame.width, height: frame.height, data };
}

/**
 * The zone where tip labels are: from a little left of the tip line to the right edge, over
 * the tips' rows with room for labels that run on past the last tip.
 *
 * @param tips - Traced tips.
 * @param width - Image width.
 * @param height - Image height.
 * @param glyphHeight - Glyph height in pixels.
 * @param overrun - Rows to add below the last tip and above the first for slanted labels.
 * @returns The zone, or null without tips in the tree.
 */
function findLabelZone(tips: Array<Tip>, width: number, height: number, glyphHeight: number, overrun: number): Box | null
{
    const xs = new Array<number>();
    let top = Infinity;
    let bottom = -Infinity;

    for (const tip of tips)
    {
        if (tip.parent !== null)
        {
            xs.push(tip.x);
            top = Math.min(top, tip.y);
            bottom = Math.max(bottom, tip.y);
        }
    }

    if (xs.length < 3)
    {
        return null;
    }

    xs.sort(compareNumbers);
    const tipLine = xs[Math.floor(xs.length / 2)];

    return {
        x0: Math.max(0, Math.round(tipLine - 1.5 * glyphHeight)),
        y0: Math.max(0, Math.round(top - 3 * glyphHeight - overrun)),
        x1: width,
        y1: Math.min(height, Math.round(bottom + 3 * glyphHeight + overrun)),
    };
}

/**
 * Orders numbers ascending.
 *
 * @param left - First number.
 * @param right - Second number.
 * @returns Their difference.
 */
function compareNumbers(left: number, right: number): number
{
    return left - right;
}

/**
 * Finds the tip labels' rows in a level frame when they are set at a slant.
 *
 * @param textInk - Text ink of the figure.
 * @param lineArtMask - Pixels known to be line art.
 * @param tips - Traced tips.
 * @param glyphHeight - Glyph height in pixels.
 * @param minAngle - Smallest slant in radians worth a frame.
 * @returns The rows and their frame, or null when the labels are level or too few to judge.
 */
export function detectSlantedLabels(textInk: Mask, lineArtMask: Mask, tips: Array<Tip>, glyphHeight: number, minAngle: number): SlantedLabels | null
{
    const measureZone = findLabelZone(tips, textInk.width, textInk.height, glyphHeight, 0);

    if (measureZone === null)
    {
        return null;
    }

    const residue = subtractMask(textInk, lineArtMask);
    const measure = measureLabelSlant(residue, measureZone, glyphHeight);

    if (measure.pairs < 15 || measure.share < 0.3 || Math.abs(measure.angle) < minAngle)
    {
        return null;
    }

    // A slanted label runs on past its tip's row by about its length times the sine.
    const overrun = Math.round(15 * glyphHeight * Math.abs(Math.sin(measure.angle)));
    const zone = findLabelZone(tips, textInk.width, textInk.height, glyphHeight, overrun) as Box;
    const frame = createRotatedFrame(zone, measure.angle);
    const detection = detectTextLines(rotateMaskToFrame(textInk, zone, frame), { lineArtMask: rotateMaskToFrame(lineArtMask, zone, frame), minY: 0 });

    for (const line of detection.lines)
    {
        line.frame = frame;
    }

    return { frame, zone, lines: detection.lines, measure };
}
