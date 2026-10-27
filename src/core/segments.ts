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

    /**
     * Collinear pairs joined across a gap with ink in it.
     */
    bridgedGaps: number;
};

/**
 * Collinear merge output.
 */
type MergeResult = {
    /**
     * Merged boxes.
     */
    boxes: Array<Box>;

    /**
     * Pairs joined across a positive gap.
     */
    bridged: number;
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
 * Splits a horizontal component into stretches of line and stretches of something taller, and
 * keeps the line. A stretch counts as taller once three columns running exceed the limit. A
 * label touching its branch, or the run of touching letters inside a bold word, is glyph-high
 * and uneven; a range bar is taller than the line but even, and is kept as line.
 *
 * @param heights - Ink height per column of the component.
 * @param box - Component box.
 * @param limit - Ink height above which a column is not line.
 * @param minRun - Shortest piece worth keeping.
 * @returns Pieces of the component that are line.
 */
function findLinePieces(heights: Array<number>, box: Box, limit: number, minRun: number): Array<Box>
{
    const pieces = new Array<Box>();
    let start = 0;
    let thickState = heights.length > 0 && heights[0] > limit;
    let streak = 0;

    for (let index = 1; index <= heights.length; index++)
    {
        const thick = index < heights.length && heights[index] > limit;

        if (index < heights.length && thick === thickState)
        {
            streak = 0;
            continue;
        }

        streak++;

        if (index < heights.length && streak < 3)
        {
            continue;
        }

        const end = index < heights.length ? index - streak + 1 : index;
        keepIfLine(heights, box, start, end, thickState, minRun, pieces);
        start = end;
        thickState = thick;
        streak = 0;
    }

    return pieces;
}

/**
 * Appends a stretch to the pieces when it is line: thin and long enough, or thick but even.
 *
 * @param heights - Ink height per column of the component.
 * @param box - Component box.
 * @param start - First column of the stretch.
 * @param end - Column after the stretch.
 * @param thick - Whether the stretch is above the limit.
 * @param minRun - Shortest thin piece worth keeping.
 * @param pieces - Receives the piece.
 */
function keepIfLine(heights: Array<number>, box: Box, start: number, end: number, thick: boolean, minRun: number, pieces: Array<Box>): void
{
    if (end - start < 1)
    {
        return;
    }

    if (thick)
    {
        let lowest = Infinity;
        let highest = 0;

        for (let index = start; index < end; index++)
        {
            lowest = Math.min(lowest, heights[index]);
            highest = Math.max(highest, heights[index]);
        }

        if (highest - lowest > 2)
        {
            return;
        }
    }
    else if (end - start < minRun)
    {
        return;
    }

    pieces.push({ x0: box.x0 + start, y0: box.y0, x1: box.x0 + end, y1: box.y1 });
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
 * Whether dark pixels fill most of the gap between two collinear boxes, within a window across
 * the line. A label box that cut a branch leaves its glyphs along the whole gap; a line
 * crossing the gap, or nothing at all, means the two pieces were never one line.
 *
 * @param ink - All dark pixels of the image.
 * @param first - The earlier box along the axis.
 * @param second - The later box.
 * @param alongX - Whether the boxes run along x.
 * @param window - Extra rows (or columns) to include on each side of the boxes.
 * @param share - Share of the gap's columns (or rows) that must hold ink.
 * @returns True when enough of the gap holds ink.
 */
function hasInkBetween(ink: Mask, first: Box, second: Box, alongX: boolean, window: number, share: number): boolean
{
    const x0 = alongX ? first.x1 : Math.max(0, Math.min(first.x0, second.x0) - window);
    const x1 = alongX ? second.x0 : Math.min(ink.width, Math.max(first.x1, second.x1) + window);
    const y0 = alongX ? Math.max(0, Math.min(first.y0, second.y0) - window) : first.y1;
    const y1 = alongX ? Math.min(ink.height, Math.max(first.y1, second.y1) + window) : second.y0;
    const steps = alongX ? x1 - x0 : y1 - y0;
    let inked = 0;

    for (let step = 0; step < steps; step++)
    {
        let found = false;

        if (alongX)
        {
            for (let y = y0; y < y1 && !found; y++)
            {
                found = ink.data[y * ink.width + x0 + step] === 1;
            }
        }
        else
        {
            for (let x = x0; x < x1 && !found; x++)
            {
                found = ink.data[(y0 + step) * ink.width + x] === 1;
            }
        }

        if (found)
        {
            inked++;
        }
    }

    return steps > 0 && inked >= share * steps;
}

/**
 * Joins collinear segments separated by a small gap, such as a branch cut by the white
 * background box of a support label. Two segments join when their cross-axis extents overlap
 * by at least half of the thinner one and the along-axis gap is at most maxGap.
 *
 * Something must have cut the line: when the ink is given, a gap with no ink in it is a real
 * gap, such as the space between a node's parent branch and the branch of a child two steps
 * to the right in a staircase layout.
 *
 * @param boxes - Segment boxes of one orientation.
 * @param alongX - Whether the segments run along x (horizontal).
 * @param maxGap - Largest gap to bridge, in pixels.
 * @param ink - All dark pixels of the image, or null to bridge any gap.
 * @param window - How far across the line to look for the ink that cut it.
 * @param gapInkShare - Share of a gap that must hold ink for the pieces to join.
 * @returns Merged boxes and the number of gaps bridged.
 */
function mergeCollinearBoxes(boxes: Array<Box>, alongX: boolean, maxGap: number, ink: Mask | null, window: number, gapInkShare: number): MergeResult
{
    const merged = new Array<Box>();
    let bridged = 0;

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

                if (overlap >= 0.5 * thinner && (ink === null || gap <= 0 || hasInkBetween(ink, first, second, alongX, window, gapInkShare)))
                {
                    if (gap > 0)
                    {
                        bridged++;
                    }

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

    return { boxes: merged, bridged };
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
 * are cut away. Verticals must be at least twice as tall as they are wide.
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
    gapInkShare = 0.4,
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
            pieces.push(...findLinePieces(heightsByComponent[index], components[index].box, limit, minHorizontalRun));
        }
    }

    const clipped = new Array<Box>();

    // A range bar clipped at its label can be short and thick, so a horizontal need only be at
    // least as long as it is thick; text has already been cut away.
    for (const piece of pieces)
    {
        for (const part of clipToTextRows(piece, textRows, minHorizontalRun))
        {
            if (part.x1 - part.x0 >= part.y1 - part.y0)
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

    const mergedHorizontals = mergeCollinearBoxes(pieces, true, maxGap, ink, Math.round(window / 2), gapInkShare);
    const mergedVerticals = mergeCollinearBoxes(verticalBoxes, false, maxVerticalGap, ink, Math.round(window / 2), gapInkShare);

    for (const box of mergedHorizontals.boxes)
    {
        horizontals.push({ id: `h${horizontals.length + 1}`, orientation: "horizontal", box });
    }

    for (const box of mergedVerticals.boxes)
    {
        verticals.push({ id: `v${verticals.length + 1}`, orientation: "vertical", box });
    }

    return { horizontals, verticals, bridgedGaps: mergedHorizontals.bridged + mergedVerticals.bridged };
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
 * Finds the short horizontal pieces that join one vertical to the next in a pectinate tree,
 * where the steps between successive nodes are shorter than the shortest run that counts as a
 * line. For each pair of verticals a few pixels apart whose spans overlap, the rows between them
 * are checked for ink running from one to the other; such a row is a branch from the left
 * vertical to the right one.
 *
 * @param lineInk - Line ink mask.
 * @param verticals - Vertical segments.
 * @param horizontals - Horizontal segments already found.
 * @param maxGap - Largest gap between the verticals' edges to look across.
 * @param thickness - Line thickness in pixels.
 * @param nextId - First identifier number to use.
 * @returns The connectors as horizontal segments.
 */
export function findShortConnectors(lineInk: Mask, verticals: Array<Segment>, horizontals: Array<Segment>, maxGap: number, thickness: number, nextId: number): Array<Segment>
{
    const { width, data } = lineInk;
    const found = new Array<Segment>();
    let id = nextId;

    // A row already covered by a horizontal segment between the two verticals is that
    // segment's own business: a branch passing through, not a missing connector.
    function isCovered(x0: number, x1: number, y: number): boolean
    {
        for (const segment of horizontals)
        {
            const { box } = segment;

            if (box.x0 <= x0 + 1 && box.x1 >= x1 - 1 && y >= box.y0 - 1 && y < box.y1 + 1)
            {
                return true;
            }
        }

        return false;
    }

    for (const left of verticals)
    {
        for (const right of verticals)
        {
            const gap = right.box.x0 - left.box.x1;

            if (left === right || gap < 1 || gap > maxGap)
            {
                continue;
            }

            const top = Math.max(left.box.y0, right.box.y0);
            const bottom = Math.min(left.box.y1, right.box.y1);

            if (bottom - top < thickness)
            {
                continue;
            }

            let runStart = -1;

            for (let y = top; y <= bottom; y++)
            {
                let inked = y < bottom;

                for (let x = left.box.x1; x < right.box.x0 && inked; x++)
                {
                    inked = data[y * width + x] === 1;
                }

                if (inked && runStart < 0)
                {
                    runStart = y;
                }
                else if (!inked && runStart >= 0)
                {
                    const half = Math.max(1, Math.round(thickness / 2));
                    const center = Math.round((runStart + y - 1) / 2);

                    if (!isCovered(left.box.x1, right.box.x0, center))
                    {
                        found.push({ id: `h${id++}`, orientation: "horizontal", box: { x0: left.box.x0, y0: center - half, x1: right.box.x1, y1: center + half + 1 } });
                    }

                    runStart = -1;
                }
            }
        }
    }

    return found;
}
