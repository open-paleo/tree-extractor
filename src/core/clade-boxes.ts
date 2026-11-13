/**
 * Clade names printed on colored boxes and bands. A figure may shade the part of the tree a
 * clade occupies and print the clade's name on the shading, away from any node. The name's
 * region is the fill it sits on, or a thin frame drawn around it within the fill; the clade is
 * the common ancestor of the tips whose labels lie in that region, and the name is attached
 * only when that ancestor has no tip outside it.
 */

import type { ExtractionDocument, RgbaImage, TextLine, Tip, TreeNode } from "./types.ts";
import { computeMedian } from "./raster.ts";

/**
 * A color as red, green and blue.
 */
type Color = {
    /**
     * Red, 0 to 255.
     */
    red: number;

    /**
     * Green, 0 to 255.
     */
    green: number;

    /**
     * Blue, 0 to 255.
     */
    blue: number;
};

/**
 * The rows of the image a label's region spans.
 */
type RowSpan = {
    /**
     * First row.
     */
    top: number;

    /**
     * Last row.
     */
    bottom: number;
};

/**
 * A frame line found beside a label.
 */
type Rule = {
    /**
     * Row of the line.
     */
    y: number;

    /**
     * Its color.
     */
    color: Color;
};

/**
 * Smallest spread between a pixel's channels for it to count as tinted.
 */
const minTint = 12;

/**
 * Reads a pixel.
 *
 * @param image - Image.
 * @param x - Column.
 * @param y - Row.
 * @returns Its color.
 */
function readColor(image: RgbaImage, x: number, y: number): Color
{
    const offset = (y * image.width + x) * 4;

    return { red: image.data[offset], green: image.data[offset + 1], blue: image.data[offset + 2] };
}

/**
 * Names the strongest channel of a color.
 *
 * @param color - Color.
 * @returns 0 for red, 1 for green, 2 for blue.
 */
function findStrongestChannel(color: Color): number
{
    if (color.red >= color.green && color.red >= color.blue)
    {
        return 0;
    }

    return color.green >= color.blue ? 1 : 2;
}

/**
 * Whether a pixel belongs to a fill: light, tinted, and tinted the fill's way. A fill that
 * fades toward white stays a fill as long as any tint is left.
 *
 * @param color - Pixel color.
 * @param channel - Strongest channel of the fill.
 * @returns True for a fill pixel.
 */
function isFillColor(color: Color, channel: number): boolean
{
    const high = Math.max(color.red, color.green, color.blue);
    const low = Math.min(color.red, color.green, color.blue);

    return high >= 140 && high - low >= minTint && findStrongestChannel(color) === channel;
}

/**
 * Whether a pixel is ink of a line: not the fill and not blank paper.
 *
 * @param color - Pixel color.
 * @param channel - Strongest channel of the fill.
 * @returns True for line ink.
 */
function isLineColor(color: Color, channel: number): boolean
{
    return !isFillColor(color, channel) && Math.min(color.red, color.green, color.blue) < 200;
}

/**
 * Measures the distance between two colors.
 *
 * @param left - One color.
 * @param right - The other.
 * @returns Largest channel difference.
 */
function measureColorDistance(left: Color, right: Color): number
{
    return Math.max(Math.abs(left.red - right.red), Math.abs(left.green - right.green), Math.abs(left.blue - right.blue));
}

/**
 * Finds the fill a text row sits on, from the light pixels of its box: the background between
 * and around its letters. Dark ink is left out, since rows packed closely bring their
 * neighbors' letters and branches into any margin. The fill must outweigh the blank paper.
 *
 * A row whose letters are themselves colored, as a clade's name on a band often is, is judged
 * from a margin around its box instead, where there are no letters.
 *
 * @param image - Image.
 * @param line - Text row.
 * @param margin - Width of the margin to sample outside the box, or 0 to sample the box.
 * @returns The fill's strongest channel, or null when the row is not on a fill.
 */
function findFillChannel(image: RgbaImage, line: TextLine, margin: number): number | null
{
    const counts = [0, 0, 0];
    let light = 0;
    const x0 = Math.max(0, line.box.x0 - margin);
    const x1 = Math.min(image.width - 1, line.box.x1 + margin);
    const y0 = Math.max(0, line.box.y0 - margin);
    const y1 = Math.min(image.height - 1, line.box.y1 + margin);

    for (let y = y0; y <= y1; y++)
    {
        for (let x = x0; x <= x1; x++)
        {
            if (margin > 0 && x >= line.box.x0 && x <= line.box.x1 && y >= line.box.y0 && y <= line.box.y1)
            {
                continue;
            }

            const color = readColor(image, x, y);
            const high = Math.max(color.red, color.green, color.blue);

            if (high < 140)
            {
                continue;
            }

            light++;

            if (high - Math.min(color.red, color.green, color.blue) >= minTint)
            {
                counts[findStrongestChannel(color)]++;
            }
        }
    }

    const channel = counts[0] >= counts[1] && counts[0] >= counts[2] ? 0 : counts[1] >= counts[2] ? 1 : 2;

    // Letters printed in a color of their own are neither fill nor paper, and do not count.
    const paper = light - counts[0] - counts[1] - counts[2];

    return counts[channel] > 0 && counts[channel] >= paper ? channel : null;
}

/**
 * Follows the fill up or down one column from a label until it ends: a stretch with no fill
 * longer than a line, a letter or a frame is wide.
 *
 * @param image - Image.
 * @param x - Column.
 * @param start - Row to start from.
 * @param step - -1 to go up, 1 to go down.
 * @param channel - Strongest channel of the fill.
 * @param maxGap - Longest stretch without fill that is passed over.
 * @returns The last fill row reached.
 */
function followFill(image: RgbaImage, x: number, start: number, step: number, channel: number, maxGap: number): number
{
    let last = start;
    let gap = 0;

    for (let y = start; y >= 0 && y < image.height && gap <= maxGap; y += step)
    {
        if (isFillColor(readColor(image, x, y), channel))
        {
            last = y;
            gap = 0;
        }
        else
        {
            gap++;
        }
    }

    return last;
}

/**
 * Measures the rows a fill spans at a label, as the median over columns across the label, so
 * that a letter or a branch in one column does not decide it.
 *
 * @param image - Image.
 * @param line - Text row.
 * @param channel - Strongest channel of the fill.
 * @param glyph - Glyph height.
 * @returns The rows of the fill.
 */
function measureFillSpan(image: RgbaImage, line: TextLine, channel: number, glyph: number): RowSpan
{
    const tops = new Array<number>();
    const bottoms = new Array<number>();
    const stride = Math.max(2, Math.round(glyph / 2));

    for (let x = Math.max(0, line.box.x0 - glyph); x <= Math.min(image.width - 1, line.box.x1 + glyph); x += stride)
    {
        tops.push(followFill(image, x, Math.max(0, line.box.y0 - 1), -1, channel, 2 * glyph));
        bottoms.push(followFill(image, x, Math.min(image.height - 1, line.box.y1 + 1), 1, channel, 2 * glyph));
    }

    return { top: computeMedian(tops, line.box.y0), bottom: computeMedian(bottoms, line.box.y1) };
}

/**
 * Finds the nearest frame line above or below a label: a row that is line ink nearly all the
 * way across the label's width.
 *
 * @param image - Image.
 * @param line - Text row.
 * @param step - -1 to look up, 1 to look down.
 * @param limit - Last row to look at.
 * @param channel - Strongest channel of the fill.
 * @param like - Color the line must have, or null for any.
 * @returns The line, or null.
 */
function findRule(image: RgbaImage, line: TextLine, step: number, limit: number, channel: number, like: Color | null): Rule | null
{
    const width = line.box.x1 - line.box.x0 + 1;

    for (let y = step < 0 ? line.box.y0 - 1 : line.box.y1 + 1; step < 0 ? y >= limit : y <= limit; y += step)
    {
        let inked = 0;
        const reds = new Array<number>();
        const greens = new Array<number>();
        const blues = new Array<number>();

        for (let x = line.box.x0; x <= line.box.x1; x++)
        {
            const color = readColor(image, x, y);

            if (isLineColor(color, channel))
            {
                inked++;
                reds.push(color.red);
                greens.push(color.green);
                blues.push(color.blue);
            }
        }

        if (inked >= 0.9 * width)
        {
            const color = { red: computeMedian(reds, 0), green: computeMedian(greens, 0), blue: computeMedian(blues, 0) };

            if (like === null || measureColorDistance(color, like) <= 70)
            {
                return { y, color };
            }
        }
    }

    return null;
}

/**
 * Whether a column of the frame's color runs between two frame lines, on either side of a
 * label: the side of a frame drawn around it.
 *
 * @param image - Image.
 * @param line - Text row.
 * @param top - Upper frame line.
 * @param bottom - Lower frame line.
 * @returns True when a side is found.
 */
function hasFrameSide(image: RgbaImage, line: TextLine, top: Rule, bottom: Rule): boolean
{
    const height = bottom.y - top.y + 1;

    for (let x = 0; x < image.width; x++)
    {
        if (x >= line.box.x0 && x <= line.box.x1)
        {
            continue;
        }

        let matching = 0;

        for (let y = top.y; y <= bottom.y; y++)
        {
            if (measureColorDistance(readColor(image, x, y), top.color) <= 70)
            {
                matching++;
            }
        }

        if (matching >= 0.85 * height)
        {
            return true;
        }
    }

    return false;
}

/**
 * Finds the rows a label's region spans: between the lines of a frame drawn around the label
 * when there is one, and the whole fill otherwise.
 *
 * @param image - Image.
 * @param line - Text row.
 * @param channel - Strongest channel of the fill.
 * @param glyph - Glyph height.
 * @returns The rows of the region.
 */
function findRegionSpan(image: RgbaImage, line: TextLine, channel: number, glyph: number): RowSpan
{
    const fill = measureFillSpan(image, line, channel, glyph);
    const above = findRule(image, line, -1, fill.top, channel, null);

    if (above !== null)
    {
        const below = findRule(image, line, 1, Math.min(image.height - 1, fill.bottom + glyph), channel, above.color);

        if (below !== null && hasFrameSide(image, line, above, below))
        {
            return { top: above.y, bottom: below.y };
        }
    }

    return fill;
}

/**
 * Whether a tip lies in a label's region: within its rows, with its own label on the fill.
 *
 * @param image - Image.
 * @param document - Extraction document.
 * @param tip - Tip.
 * @param span - Rows of the region.
 * @param channel - Strongest channel of the fill.
 * @param glyph - Glyph height.
 * @returns True for a tip of the region.
 */
function isTipInRegion(image: RgbaImage, document: ExtractionDocument, tip: Tip, span: RowSpan, channel: number, glyph: number): boolean
{
    if (tip.y < span.top || tip.y > span.bottom)
    {
        return false;
    }

    for (const line of document.textLines)
    {
        if (line.id === tip.textLine)
        {
            return findFillChannel(image, line, 0) === channel;
        }
    }

    const x = Math.min(image.width - 1, Math.round(tip.x + glyph));

    return isFillColor(readColor(image, x, Math.max(0, Math.round(tip.y - glyph))), channel);
}

/**
 * Collects the tips under a node.
 *
 * @param nodeById - Nodes by identifier.
 * @param id - Node or tip identifier.
 * @param into - Set to add tip identifiers to.
 */
function collectTips(nodeById: Map<string, TreeNode>, id: string, into: Set<string>): void
{
    const node = nodeById.get(id);

    if (node === undefined)
    {
        into.add(id);

        return;
    }

    for (const child of node.children)
    {
        collectTips(nodeById, child, into);
    }
}

/**
 * Finds the node whose tips are exactly a given set.
 *
 * @param document - Extraction document.
 * @param tips - Tip identifiers.
 * @returns The node, or null when no node has just those tips.
 */
function findNodeWithTips(document: ExtractionDocument, tips: Set<string>): TreeNode | null
{
    const nodeById = new Map<string, TreeNode>();

    for (const node of document.nodes)
    {
        nodeById.set(node.id, node);
    }

    for (const node of document.nodes)
    {
        const under = new Set<string>();
        collectTips(nodeById, node.id, under);

        if (under.size !== tips.size)
        {
            continue;
        }

        let same = true;

        for (const id of tips)
        {
            same = same && under.has(id);
        }

        if (same)
        {
            return node;
        }
    }

    return null;
}

/**
 * Pairs text rows printed on colored boxes and bands with the clades those shade. A paired
 * row becomes the node's name row, to be read with the other labels.
 *
 * @param document - Extraction document, with tips and nodes already paired with their rows.
 * @param image - The image the document's coordinates refer to.
 */
export function assignBoxedNames(document: ExtractionDocument, image: RgbaImage): void
{
    const glyph = document.glyphHeight;

    for (const line of document.textLines)
    {
        if (line.role !== "unassigned" || line.glyphCount < 4)
        {
            continue;
        }

        const channel = findFillChannel(image, line, Math.max(3, Math.round(glyph / 3)));

        if (channel === null)
        {
            continue;
        }

        const span = findRegionSpan(image, line, channel, glyph);
        const tips = new Set<string>();

        for (const tip of document.tips)
        {
            if (isTipInRegion(image, document, tip, span, channel, glyph))
            {
                tips.add(tip.id);
            }
        }

        if (tips.size < 2)
        {
            continue;
        }

        const node = findNodeWithTips(document, tips);

        // A region whose tips are not one clade is left alone: a band naming a grade, boxes
        // that overlap, or a row that is no clade's name at all.
        if (node !== null && (node.nameLine === undefined || node.nameLine === null))
        {
            node.nameLine = line.id;
            line.role = "node";
        }
    }
}
