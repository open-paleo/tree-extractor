/**
 * Extracts straight horizontal and vertical segments from a line-art mask. Each direction is
 * taken as the connected components of the mask of long runs in that direction only.
 */

import type { Box, Mask, Segment } from "./types.ts";
import { createDirectionalRunMask, findConnectedComponents } from "./raster.ts";

/**
 * The segments found in a mask.
 */
export type SegmentSet = {
    /**
     * Horizontal segments (branches).
     */
    horizontals: Array<Segment>;

    /**
     * Vertical segments (node connectors).
     */
    verticals: Array<Segment>;
};

/**
 * Measures, for each column of a component, how tall the dark ink is through that column.
 *
 * @param ink - All dark pixels of the image.
 * @param box - Component box in the run mask.
 * @param window - How far above and below the box to look.
 * @returns Ink height per column.
 */
function measureColumnHeights(ink: Mask, box: Box, window: number): Array<number>
{
    const heights = new Array<number>();
    const top = Math.max(0, box.y0 - window);
    const bottom = Math.min(ink.height, box.y1 + window);

    for (let x = box.x0; x < box.x1; x++)
    {
        let count = 0;

        for (let y = top; y < bottom; y++)
        {
            count += ink.data[y * ink.width + x];
        }

        heights.push(count);
    }

    return heights;
}

/**
 * Splits a horizontal component wherever the ink through it becomes much taller than a line
 * for three columns running, and keeps only the thin stretches. A label touching its branch, or
 * the run of touching letters inside a bold word, is glyph-high; a branch or a range bar is not.
 *
 * @param heights - Ink height per column of the component.
 * @param box - Component box.
 * @param limit - Ink height above which a column is text.
 * @param minRun - Shortest piece worth keeping.
 * @returns Thin pieces of the component.
 */
function findThinStretches(heights: Array<number>, box: Box, limit: number, minRun: number): Array<Box>
{
    const pieces = new Array<Box>();
    let start = -1;
    let thickStreak = 0;

    for (let index = 0; index <= heights.length; index++)
    {
        const thick = index < heights.length && heights[index] > limit;
        thickStreak = thick ? thickStreak + 1 : 0;

        if (index === heights.length || thickStreak === 3)
        {
            const end = index === heights.length ? index : index - 2;

            if (start >= 0 && end - start >= minRun)
            {
                pieces.push({ x0: box.x0 + start, y0: box.y0, x1: box.x0 + end, y1: box.y1 });
            }

            start = -1;
        }
        else if (!thick && start < 0)
        {
            start = index;
        }
    }

    return pieces;
}

/**
 * Removes from a horizontal piece every stretch that lies under a text row, keeping the parts
 * outside. A label that touches its branch continues the branch's ink; this is where it stops.
 *
 * @param box - Horizontal piece.
 * @param textRows - Boxes of text rows.
 * @param minRun - Shortest part worth keeping.
 * @returns Parts of the piece outside every text row.
 */
function clipToTextRows(box: Box, textRows: Array<Box>, minRun: number): Array<Box>
{
    const height = box.y1 - box.y0;
    const blocked = new Array<Box>();

    for (const row of textRows)
    {
        const overlap = Math.min(row.y1, box.y1) - Math.max(row.y0, box.y0);

        if (overlap >= 0.5 * height && row.x1 > box.x0 && row.x0 < box.x1)
        {
            blocked.push(row);
        }
    }

    if (blocked.length === 0)
    {
        return [box];
    }

    blocked.sort(compareLeftEdges);
    const parts = new Array<Box>();
    let cursor = box.x0;

    for (const row of blocked)
    {
        const start = Math.max(box.x0, row.x0);

        if (start - cursor >= minRun)
        {
            parts.push({ x0: cursor, y0: box.y0, x1: start, y1: box.y1 });
        }

        cursor = Math.max(cursor, Math.min(box.x1, row.x1));
    }

    if (box.x1 - cursor >= minRun)
    {
        parts.push({ x0: cursor, y0: box.y0, x1: box.x1, y1: box.y1 });
    }

    return parts;
}

/**
 * Orders boxes by left edge.
 *
 * @param left - First box.
 * @param right - Second box.
 * @returns Negative when the first is further left.
 */
function compareLeftEdges(left: Box, right: Box): number
{
    return left.x0 - right.x0;
}

/**
 * Orders boxes by top edge.
 *
 * @param left - First box.
 * @param right - Second box.
 * @returns Negative when the first is higher.
 */
function compareTopEdges(left: Box, right: Box): number
{
    return left.y0 - right.y0;
}

/**
 * Joins collinear segments separated by a small gap, such as a branch cut by the white
 * background box of a support label. Two segments join when their cross-axis extents overlap
 * by at least half of the thinner one and the along-axis gap is at most maxGap.
 *
 * @param boxes - Segment boxes of one orientation.
 * @param alongX - Whether the segments run along x (horizontal).
 * @param maxGap - Largest gap to bridge, in pixels.
 * @returns Merged boxes.
 */
function mergeCollinearBoxes(boxes: Array<Box>, alongX: boolean, maxGap: number): Array<Box>
{
    const merged = new Array<Box>();

    for (const box of boxes)
    {
        merged.push({ x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 });
    }

    let changed = true;

    while (changed)
    {
        changed = false;
        merged.sort(alongX ? compareLeftEdges : compareTopEdges);

        for (let index = 0; index < merged.length && !changed; index++)
        {
            const first = merged[index];

            for (let other = index + 1; other < merged.length; other++)
            {
                const second = merged[other];
                const gap = alongX ? second.x0 - first.x1 : second.y0 - first.y1;

                if (gap > maxGap)
                {
                    break;
                }

                const overlap = alongX
                    ? Math.min(first.y1, second.y1) - Math.max(first.y0, second.y0)
                    : Math.min(first.x1, second.x1) - Math.max(first.x0, second.x0);
                const thinner = alongX
                    ? Math.min(first.y1 - first.y0, second.y1 - second.y0)
                    : Math.min(first.x1 - first.x0, second.x1 - second.x0);

                if (overlap >= 0.5 * thinner)
                {
                    first.x0 = Math.min(first.x0, second.x0);
                    first.y0 = Math.min(first.y0, second.y0);
                    first.x1 = Math.max(first.x1, second.x1);
                    first.y1 = Math.max(first.y1, second.y1);
                    merged.splice(other, 1);
                    changed = true;
                    break;
                }
            }
        }
    }

    return merged;
}

/**
 * Tells whether a box lies entirely inside any of a set of boxes.
 *
 * @param box - Box to test.
 * @param containers - Candidate containing boxes.
 * @returns True when some container holds the box.
 */
function isInsideAny(box: Box, containers: Array<Box>): boolean
{
    for (const container of containers)
    {
        if (box.x0 >= container.x0 && box.x1 <= container.x1 && box.y0 >= container.y0 && box.y1 <= container.y1)
        {
            return true;
        }
    }

    return false;
}

/**
 * Extracts horizontal and vertical segments from a line-art mask. Each direction is taken from
 * a mask of long runs in that direction only, so a thick horizontal cannot masquerade as a short
 * vertical and a vertical cannot be swallowed by the horizontal it crosses. Broken pieces of one
 * line on neighboring rows join through connectivity, and stretches where the ink is glyph-high
 * are cut away. Segments must be at least twice as long as they are thick.
 *
 * @param lineArt - Mask of line-art pixels (glyphs already removed).
 * @param minHorizontalRun - Shortest horizontal run that counts as a branch.
 * @param minVerticalRun - Shortest vertical run that counts as a connector.
 * @param maxGap - Largest gap bridged between collinear pieces of one horizontal.
 * @param maxVerticalGap - Largest gap bridged between collinear pieces of one vertical; kept
 * small because nodes at the same depth stack vertically.
 * @param ink - All dark pixels, used to cut text off branches by its height; null to skip.
 * @param window - How far above and below a run to look for ink when measuring height.
 * @param textRows - Boxes of text rows; horizontals are clipped out of them and verticals inside
 * them are dropped.
 * @returns The segments found.
 */
export function extractSegments(
    lineArt: Mask,
    minHorizontalRun: number,
    minVerticalRun: number,
    maxGap = 0,
    maxVerticalGap = maxGap,
    ink: Mask | null = null,
    window = 0,
    textRows: Array<Box> = [],
): SegmentSet
{
    const horizontalMask = createDirectionalRunMask(lineArt, minHorizontalRun, true);
    const components = findConnectedComponents(horizontalMask).components;
    let pieces = new Array<Box>();

    if (ink === null)
    {
        for (const component of components)
        {
            pieces.push(component.box);
        }
    }
    else
    {
        const heightsByComponent = new Array<Array<number>>();
        const allHeights = new Array<number>();

        for (const component of components)
        {
            const heights = measureColumnHeights(ink, component.box, window);
            heightsByComponent.push(heights);

            for (const height of heights)
            {
                if (height > 0)
                {
                    allHeights.push(height);
                }
            }
        }

        allHeights.sort(compareNumbers);
        const lineWidth = allHeights[Math.floor(allHeights.length / 2)] ?? 1;
        const limit = Math.max(2.5 * lineWidth + 1, lineWidth + 5);

        for (let index = 0; index < components.length; index++)
        {
            pieces.push(...findThinStretches(heightsByComponent[index], components[index].box, limit, minHorizontalRun));
        }
    }

    const clipped = new Array<Box>();

    for (const piece of pieces)
    {
        for (const part of clipToTextRows(piece, textRows, minHorizontalRun))
        {
            if (part.x1 - part.x0 >= 2 * (part.y1 - part.y0))
            {
                clipped.push(part);
            }
        }
    }

    pieces = clipped;
    const verticalBoxes = new Array<Box>();

    for (const component of findConnectedComponents(createDirectionalRunMask(lineArt, minVerticalRun, false)).components)
    {
        const box = component.box;

        if (box.y1 - box.y0 >= 2 * (box.x1 - box.x0) && !isInsideAny(box, textRows))
        {
            verticalBoxes.push(box);
        }
    }

    const horizontals = new Array<Segment>();
    const verticals = new Array<Segment>();

    for (const box of mergeCollinearBoxes(pieces, true, maxGap))
    {
        horizontals.push({ id: `h${horizontals.length + 1}`, orientation: "horizontal", box });
    }

    for (const box of mergeCollinearBoxes(verticalBoxes, false, maxVerticalGap))
    {
        verticals.push({ id: `v${verticals.length + 1}`, orientation: "vertical", box });
    }

    return { horizontals, verticals };
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
