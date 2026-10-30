/**
 * Things drawn in color or around the figure that the neutral line ink leaves out or lets in
 * wrongly: thin colored lines (branches drawn in color), fat colored shapes (range ovals, clade
 * fills), and the frame some figures draw around themselves.
 */

import type { Box, ExtractionDocument, Mask, QcIssue, RgbaImage, Segment } from "./types.ts";
import { createMaskFromComponents, dilate, erode, findConnectedComponents, subtractMask, closeMask, invertMask } from "./raster.ts";
import { deleteTip } from "./edit.ts";

/**
 * Colored ink split by shape.
 */
export type ColoredInk = {
    /**
     * Thin colored strokes: lines drawn in color, which belong with the line ink.
     */
    thin: Mask;

    /**
     * Fat colored shapes: markers and fills, which are neither lines nor text.
     */
    fat: Mask;
};

/**
 * Splits the dark colored pixels of an image into thin strokes and fat shapes. A shape is fat
 * where it survives an erosion of the given radius; the fat mask is that core grown back by a
 * pixel more, so that the anti-aliased rim of a marker goes with the marker.
 *
 * @param image - Source image.
 * @param threshold - Luminance below which a colored pixel counts as dark.
 * @param minChroma - Chroma a pixel must exceed to count as colored. Set well above the
 * neutral limit, since JPEG leaves fringes of moderate chroma along black lines on tinted
 * backgrounds, and those would thicken the lines with false ink.
 * @param radius - Half-width of the erosion square; strokes thinner than its width are thin.
 * @returns The two masks.
 */
export function splitColoredInk(image: RgbaImage, threshold: number, minChroma: number, radius: number): ColoredInk
{
    const colored = createColoredMask(image, threshold, minChroma);
    const core = erode(colored, radius);
    const grown = dilate(core, radius + 1);
    const fat = subtractMask(colored, subtractMask(colored, grown));
    const thin = subtractMask(colored, fat);
    removeOutlines(thin, 8 * radius, 2 * radius + 3);

    return { thin, fat };
}

/**
 * Marks pixels that are both dark and strongly colored.
 *
 * @param image - Source image.
 * @param threshold - Luminance below which a pixel counts as dark.
 * @param minChroma - Chroma a pixel must exceed.
 * @returns The mask.
 */
export function createColoredMask(image: RgbaImage, threshold: number, minChroma: number): Mask
{
    const { width, height, data } = image;
    const mask = new Uint8Array(width * height);

    for (let index = 0; index < width * height; index++)
    {
        const offset = index * 4;
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
        const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);

        if (luminance < threshold && chroma > minChroma)
        {
            mask[index] = 1;
        }
    }

    return { width, height, data: mask };
}

/**
 * Clears thin components that are the outline of a rectangle: a colored border around a clade
 * box, which is neither a line of the tree nor a marker. Branches crossing the border cut it
 * into pieces, so the mask is grown first to join them again; a joined component is an outline
 * when it is at least a given size each way and nearly all of its pixels lie along its
 * bounding box.
 *
 * @param thin - Thin colored mask, modified in place.
 * @param minSize - Smallest width and height of an outline.
 * @param rim - How far in from the bounding box a pixel still counts as on the border.
 */
function removeOutlines(thin: Mask, minSize: number, rim: number): void
{
    const { width, components, labels } = { width: thin.width, ...findConnectedComponents(dilate(thin, Math.max(2, Math.round(rim / 2)))) };
    const onBorder = new Int32Array(components.length);

    for (let index = 0; index < labels.length; index++)
    {
        const label = labels[index];

        if (label === 0)
        {
            continue;
        }

        const box = components[label - 1].box;
        const x = index % width;
        const y = Math.floor(index / width);

        if (x < box.x0 + rim || x >= box.x1 - rim || y < box.y0 + rim || y >= box.y1 - rim)
        {
            onBorder[label - 1]++;
        }
    }

    const outlines = new Set<number>();

    for (let index = 0; index < components.length; index++)
    {
        const { box, area } = components[index];

        if (box.x1 - box.x0 >= minSize && box.y1 - box.y0 >= minSize && onBorder[index] >= 0.85 * area)
        {
            outlines.add(index + 1);
        }
    }

    if (outlines.size === 0)
    {
        return;
    }

    for (let index = 0; index < labels.length; index++)
    {
        if (outlines.has(labels[index]))
        {
            thin.data[index] = 0;
        }
    }
}

/**
 * What removing a stage chart found.
 */
export type ChartStripFind = {
    /**
     * One informational issue per strip dropped.
     */
    issues: Array<QcIssue>;

    /**
     * The long rules of each strip, kept aside for the time axis: the ages are printed along
     * one of them.
     */
    axisRules: Array<Segment>;

    /**
     * The short verticals of each strip, kept aside with the rules: the axis may be a row of
     * ticks with no line.
     */
    axisTicks: Array<Segment>;
};

/**
 * Removes stage charts: a strip along the top or bottom of the figure, bounded by a rule
 * spanning two fifths of the width, holding eight or more dividers in rows. A time tree's
 * chart of periods, epochs and stages is drawn that way, and once a branch touches a rule,
 * every divider becomes a tip. Dividers are told from a tree's connectors by their rows: the
 * dividers between two rules share a top and a bottom, four or more at a time, as connectors
 * never do. The innermost qualifying rule with a divider row within six glyphs of it and no
 * connector running on from it into the tree bounds the strip, and every segment lying within
 * the strip goes, the rules included; the long rules and the short verticals are returned so
 * the time axis can still be read.
 *
 * @param horizontals - Horizontal segments, rewritten in place.
 * @param verticals - Vertical segments, rewritten in place.
 * @param width - Image width.
 * @param height - Image height.
 * @param glyphHeight - Glyph height in pixels.
 * @param thickness - Line thickness in pixels.
 * @returns Issues and the rules kept for the axis.
 */
export function removeChartStrips(horizontals: Array<Segment>, verticals: Array<Segment>, width: number, height: number, glyphHeight: number, thickness: number): ChartStripFind
{
    const issues = new Array<QcIssue>();
    const axisRules = new Array<Segment>();
    const axisTicks = new Array<Segment>();
    const slack = Math.max(2, Math.round(thickness));
    // A band edge may run a little past the rule it stands on.
    const overshoot = Math.max(slack, glyphHeight);
    const bin = 2 * slack;

    function keyRow(box: Box): string
    {
        return `${Math.round(box.y0 / bin)}:${Math.round(box.y1 / bin)}`;
    }

    // A divider stands on a rule, or hangs from one: a horizontal of any length meets one of
    // its ends. The dashes of a dashed stage line through a tree align in rows too, and meet
    // nothing.
    function meetsHorizontal(box: Box): boolean
    {
        for (const horizontal of horizontals)
        {
            const other = horizontal.box;

            if (other.x0 <= box.x1 + slack && other.x1 >= box.x0 - slack
                && ((other.y1 >= box.y0 - slack && other.y0 <= box.y0 + slack) || (other.y1 >= box.y1 - slack && other.y0 <= box.y1 + slack)))
            {
                return true;
            }
        }

        return false;
    }

    function findDividerRows(stripTop: number, stripBottom: number): Map<string, number>
    {
        const rows = new Map<string, number>();

        for (const vertical of verticals)
        {
            const { box } = vertical;

            if (box.y0 >= stripTop - overshoot && box.y1 <= stripBottom + overshoot && meetsHorizontal(box))
            {
                const key = keyRow(box);
                rows.set(key, (rows.get(key) ?? 0) + 1);
            }
        }

        for (const [key, members] of rows)
        {
            if (members < 4)
            {
                rows.delete(key);
            }
        }

        return rows;
    }

    function countDividers(rows: Map<string, number>): number
    {
        let count = 0;

        for (const members of rows.values())
        {
            count += members;
        }

        return count;
    }

    // The gap between the rule and the nearest divider row: a chart's rule has its dividers
    // right under it, a long branch in the tree above the chart has the tree's last rows in
    // between.
    function measureGapToRows(rows: Map<string, number>, rule: Segment, atTop: boolean): number
    {
        let gap = Infinity;

        for (const vertical of verticals)
        {
            const { box } = vertical;

            if (rows.has(keyRow(box)))
            {
                gap = Math.min(gap, Math.max(0, atTop ? rule.box.y0 - box.y1 : box.y0 - rule.box.y1));
            }
        }

        return gap;
    }

    // A long branch just inside the chart is as long and as deep as a rule, but a connector
    // meets it and runs on into the tree; a band edge crossing a chart rule runs a couple of
    // glyphs past it at most.
    function hasConnector(rule: Segment, atTop: boolean): boolean
    {
        const reach = 3 * glyphHeight;

        for (const vertical of verticals)
        {
            const { box } = vertical;
            const meets = box.x0 <= rule.box.x1 + slack && box.x1 >= rule.box.x0 - slack && box.y1 >= rule.box.y0 - slack && box.y0 <= rule.box.y1 + slack;
            const beyond = atTop ? box.y1 - rule.box.y1 : rule.box.y0 - box.y0;

            if (meets && beyond > reach)
            {
                return true;
            }
        }

        return false;
    }

    for (const atTop of [true, false])
    {
        let best: Segment | null = null;
        let bestDepth = 0;
        let bestDividers = 0;

        for (const rule of horizontals)
        {
            const depth = atTop ? rule.box.y1 : height - rule.box.y0;

            if (rule.box.x1 - rule.box.x0 < 0.4 * width || depth > 0.35 * height)
            {
                continue;
            }

            const rows = findDividerRows(atTop ? 0 : rule.box.y0, atTop ? rule.box.y1 : height);
            const dividers = countDividers(rows);

            if (dividers >= 8 && depth > bestDepth && !hasConnector(rule, atTop) && measureGapToRows(rows, rule, atTop) <= 6 * glyphHeight)
            {
                best = rule;
                bestDepth = depth;
                bestDividers = dividers;
            }
        }

        if (best === null)
        {
            continue;
        }

        // Segments within the strip go; a divider in a row may run a little past the rule, but
        // a tree's own segment that close to the rule stays.
        const stripTop = atTop ? 0 : best.box.y0 - slack;
        const stripBottom = atTop ? best.box.y1 + slack : height;
        const rows = findDividerRows(atTop ? 0 : best.box.y0, atTop ? best.box.y1 : height);
        let dropped = 0;

        for (const list of [horizontals, verticals])
        {
            const kept = new Array<Segment>();

            for (const segment of list)
            {
                const { box } = segment;
                const inside = box.y0 >= stripTop && box.y1 <= stripBottom;
                const inRow = list === verticals && box.y0 >= stripTop - overshoot && box.y1 <= stripBottom + overshoot && rows.has(keyRow(box));

                if (inside || inRow)
                {
                    dropped++;

                    if (list === horizontals ? box.x1 - box.x0 >= 0.4 * width : box.y1 - box.y0 <= 3 * glyphHeight)
                    {
                        (list === horizontals ? axisRules : axisTicks).push(segment);
                    }
                }
                else
                {
                    kept.push(segment);
                }
            }

            list.length = 0;
            list.push(...kept);
        }

        issues.push({ severity: "info", code: "chart-strip-dropped", message: `a stage chart along the ${atTop ? "top" : "bottom"} edge, bounded by ${best.id} with ${bestDividers} divider(s) in rows, was dropped (${dropped} segment(s))`, subject: null });
    }

    return { issues, axisRules, axisTicks };
}

/**
 * Removes chart lines: a line spanning much of the figure that many segments of the other
 * direction cross or end on. A stratigraphic band at the top of a time tree is a width-wide
 * rule with dozens of stage dividers standing on it, and once a branch touches it, the
 * dividers become tips of the tree. Nothing crosses a node connector, and the stem of a dense
 * tree has many branches ending on it, so only crossings count, and they must not be dwarfed
 * by endings. A band whose dividers stand on it without crossing (Wang 2025) is not caught;
 * counting endings instead took a scale of Ke 2023 with it.
 *
 * @param horizontals - Horizontal segments, rewritten in place.
 * @param verticals - Vertical segments, rewritten in place.
 * @param width - Image width.
 * @param height - Image height.
 * @returns One informational issue per line dropped.
 */
export function removeChartLines(horizontals: Array<Segment>, verticals: Array<Segment>, width: number, height: number): Array<QcIssue>
{
    const issues = new Array<QcIssue>();

    function judge(lines: Array<Segment>, others: Array<Segment>, alongX: boolean): Array<Segment>
    {
        const kept = new Array<Segment>();
        const span = alongX ? width : height;

        for (const line of lines)
        {
            const { box } = line;
            const length = alongX ? box.x1 - box.x0 : box.y1 - box.y0;
            let crossing = 0;
            let ending = 0;

            if (length >= 0.4 * span)
            {
                for (const other of others)
                {
                    const otherBox = other.box;
                    const overlaps = alongX ? otherBox.x0 < box.x1 && otherBox.x1 > box.x0 : otherBox.y0 < box.y1 && otherBox.y1 > box.y0;

                    if (!overlaps)
                    {
                        continue;
                    }

                    const before = alongX ? otherBox.y0 < box.y0 - 2 : otherBox.x0 < box.x0 - 2;
                    const after = alongX ? otherBox.y1 > box.y1 + 2 : otherBox.x1 > box.x1 + 2;

                    if (before && after)
                    {
                        crossing++;
                    }
                    else if (before || after)
                    {
                        ending++;
                    }
                }
            }

            if (crossing >= 6 && crossing >= ending / 4)
            {
                issues.push({ severity: "info", code: "chart-line-dropped", message: `${line.orientation} ${line.id} spanning the figure with ${crossing} segment(s) crossing and ${ending} ending on it was dropped as a chart line`, subject: null });
            }
            else
            {
                kept.push(line);
            }
        }

        return kept;
    }

    const keptHorizontals = judge(horizontals, verticals, true);
    const keptVerticals = judge(verticals, horizontals, false);
    horizontals.length = 0;
    horizontals.push(...keptHorizontals);
    verticals.length = 0;
    verticals.push(...keptVerticals);

    return issues;
}

/**
 * The fat shapes of a mask: regions that survive an erosion, grown back by a pixel more. On
 * the line ink these are collapsed-clade wedges, filled discs and thick bars, never lines.
 *
 * @param mask - Source mask.
 * @param radius - Half-width of the erosion square; anything thinner than its width is not fat.
 * @returns The fat shapes.
 */
export function findFatShapes(mask: Mask, radius: number): Mask
{
    const grown = dilate(erode(mask, radius), radius + 1);

    return subtractMask(mask, subtractMask(mask, grown));
}

/**
 * Drops segments that are the frame around the figure: a horizontal or vertical within a
 * margin of the image edge that spans most of the image. A frame's left edge is a vertical as
 * tall as the image, which would otherwise become the root of everything.
 *
 * @param segments - Segments of one orientation, modified in place.
 * @param width - Image width.
 * @param height - Image height.
 * @returns One issue per segment dropped.
 */
export function removeFrameSegments(segments: Array<Segment>, width: number, height: number): Array<QcIssue>
{
    const issues = new Array<QcIssue>();
    const kept = new Array<Segment>();
    const marginX = Math.max(4, Math.round(0.02 * width));
    const marginY = Math.max(4, Math.round(0.02 * height));

    for (const segment of segments)
    {
        const { box } = segment;
        let frame = false;

        if (segment.orientation === "horizontal")
        {
            const atEdge = box.y0 <= marginY || box.y1 >= height - marginY;
            frame = atEdge && box.x1 - box.x0 >= 0.9 * width;
        }
        else
        {
            const atEdge = box.x0 <= marginX || box.x1 >= width - marginX;
            frame = atEdge && box.y1 - box.y0 >= 0.9 * height;
        }

        if (frame)
        {
            issues.push({
                severity: "info",
                code: "frame-dropped",
                message: `${segment.orientation} ${segment.id} along the image edge spanning the figure was dropped as a frame`,
                subject: null,
            });
        }
        else
        {
            kept.push(segment);
        }
    }

    segments.length = 0;
    segments.push(...kept);

    return issues;
}

/**
 * Keeps only the components of a mask that fit a marker: a range oval, a wedge or a bar is at
 * most a few glyphs tall, while a clade fill or a silhouette is far larger, and a branch that
 * runs into one of those does not end on its far side.
 *
 * @param mask - Fat shapes.
 * @param maxWidth - Widest component kept.
 * @param maxHeight - Tallest component kept.
 * @returns The small components as a mask.
 */
export function keepSmallShapes(mask: Mask, maxWidth: number, maxHeight: number): Mask
{
    const { components, labels } = findConnectedComponents(mask);
    const selected = new Set<number>();

    for (let index = 0; index < components.length; index++)
    {
        const { box } = components[index];

        if (box.x1 - box.x0 <= maxWidth && box.y1 - box.y0 <= maxHeight)
        {
            selected.add(index + 1);
        }
    }

    return createMaskFromComponents(labels, selected, mask.width, mask.height);
}

/**
 * Moves each tip's end to the far side of a fat marker that touches it: a range oval or a bar
 * drawn in color sits between the branch end and the label, and the label is measured from
 * where the marker ends.
 *
 * @param document - Document updated in place.
 * @param fat - Fat shapes.
 * @param thickness - Line thickness in pixels.
 * @param maxGap - Largest gap between the branch end and the shape that still counts.
 * @param labelReach - When given, a move is kept only when a text row begins within this many
 * pixels past the new end; shapes in any pale tint include stage bands and fills that no
 * label follows.
 * @returns Number of tips moved.
 */
export function extendTipsThroughMarkers(document: ExtractionDocument, fat: Mask, thickness: number, maxGap: number, labelReach: number | null = null): number
{
    const { width, height, data } = fat;
    const half = Math.max(1, Math.round(thickness));
    let moved = 0;
    const absorbed = new Array<string>();

    function hasLabelBeyond(end: number, y: number): boolean
    {
        for (const line of document.textLines)
        {
            if (line.glyphCount >= 2 && line.box.x0 >= end - 2 && line.box.x0 <= end + (labelReach as number) && line.box.y0 <= y + half && line.box.y1 >= y - half)
            {
                return true;
            }
        }

        return false;
    }

    for (const tip of document.tips)
    {
        const top = Math.max(0, Math.round(tip.y) - half);
        const bottom = Math.min(height - 1, Math.round(tip.y) + half);
        let end = -1;
        let gap = 0;

        for (let x = Math.round(tip.x); x < width; x++)
        {
            let marker = false;

            for (let y = top; y <= bottom && !marker; y++)
            {
                marker = data[y * width + x] === 1;
            }

            if (marker)
            {
                end = x;
                gap = 0;
            }
            else if (++gap > (end < 0 ? maxGap : 3))
            {
                break;
            }
        }

        if (end > tip.x + 2 && (labelReach === null || hasLabelBeyond(end + 1, Math.round(tip.y))))
        {
            tip.extendedFrom ??= tip.x;
            tip.x = end + 1;
            moved++;
        }
    }

    // A range bar traced as a segment of its own has a tip at its far end already, hung from
    // whatever its end touched (a stage boundary, say), and now the branch that ran into the
    // bar ends there too. The branch that started further left is the real one; the other goes.
    for (const tip of document.tips)
    {
        for (const other of document.tips)
        {
            if (other !== tip && Math.abs(other.x - tip.x) <= 2 * half + 2 && Math.abs(other.y - tip.y) <= half
                && (other.extendedFrom ?? other.x) > (tip.extendedFrom ?? tip.x) && !absorbed.includes(tip.id))
            {
                absorbed.push(other.id);
            }
        }
    }

    for (const id of absorbed)
    {
        deleteTip(document, id);
    }

    return moved;
}

/**
 * Finds filled discs the size of a node marker: a numbered circle drawn over a junction. Such a
 * disc is round, a glyph or three across, and mostly filled even with a digit knocked out of
 * it. Its halves beside the digit pass for glyphs and leave the line art, which cuts the
 * branches at the junction they cover.
 *
 * The digit's strokes are closed first, so the disc is solid, and the ink is then eroded by
 * the line thickness, so the branches vanish and the disc's core remains, to be measured and
 * grown back. An open ring around a junction is found by its outline instead. A disc is as wide as it is tall, to a tenth, and solid before the closing (half
 * its box inked at least, where a two-digit support value closed into a blob inks a third),
 * and lines enter it on at least two sides, which a label beside a branch has not.
 *
 * @param textInk - Dark pixels at the text threshold.
 * @param lineInk - Line ink, for the branches entering the disc.
 * @param glyphHeight - Glyph height in pixels.
 * @param thickness - Line thickness in pixels.
 * @param tintInk - Everything that is not white, for pale solid discs; the text ink by default.
 * @returns Bounding boxes of the discs.
 */
export function findNodeDiscs(textInk: Mask, lineInk: Mask, glyphHeight: number, thickness: number, tintInk: Mask = textInk): Array<Box>
{
    const radius = Math.max(2, Math.round(thickness / 2) + 1);
    const discs = new Array<Box>();

    // Solid discs: dark ones in the text ink, half inked at least; then pale ones in everything
    // that is not white, which must be nearly solid, since the gray fringe of a thick mark
    // passes the looser test.
    for (const [ink, minShare] of [[textInk, 0.5], [tintInk, 0.7]] as Array<[Mask, number]>)
    {
        const closed = closeMask(ink, Math.max(2, Math.round(glyphHeight / 5)));
        const { components } = findConnectedComponents(erode(closed, radius));

        for (const component of components)
        {
            const coreWidth = component.box.x1 - component.box.x0;
            const coreHeight = component.box.y1 - component.box.y0;
            const width = coreWidth + 2 * radius;
            const height = coreHeight + 2 * radius;
            const size = Math.max(width, height);

            if (size < 1.5 * glyphHeight || size > 3.5 * glyphHeight || Math.abs(width - height) > 0.1 * size + 1 || component.area < 0.6 * coreWidth * coreHeight)
            {
                continue;
            }

            const box: Box = { x0: component.box.x0 - radius, y0: component.box.y0 - radius, x1: component.box.x1 + radius, y1: component.box.y1 + radius };

            if (measureInkShare(ink, box) >= minShare && countSidesEntered(lineInk, box, thickness) >= 2 && !overlapsAny(discs, box))
            {
                discs.push(box);
            }
        }
    }

    // Rings: an open circle drawn around a junction, with a letter or a number inside. Its
    // outline joins the lines that enter it, so it is found by its hole: a white region that
    // touches no edge, a glyph to three across, round (a circle fills about four fifths of its
    // box, less the letters inside, a gap between branches all of it), with lines entering on
    // two sides. The least fill, 0.575, lets a ring with two wide letters through (Barker 2021's
    // "DE" ring fills 0.60, its "C" rings 0.58) and keeps out the numbered callout rings of
    // Alarcón-Muñoz 2023 (0.57), which sit beside the tree with arrows to the nodes; it is a
    // thin margin.
    const holes = findConnectedComponents(invertMask(textInk)).components;

    for (const hole of holes)
    {
        const width = hole.box.x1 - hole.box.x0;
        const height = hole.box.y1 - hole.box.y0;
        const size = Math.max(width, height);
        const share = hole.area / Math.max(1, width * height);
        const touchesEdge = hole.box.x0 === 0 || hole.box.y0 === 0 || hole.box.x1 === textInk.width || hole.box.y1 === textInk.height;

        if (touchesEdge || size < glyphHeight || size > 3 * glyphHeight || Math.abs(width - height) > 0.1 * size + 1 || share < 0.575 || share > 0.88)
        {
            continue;
        }

        const rim = Math.max(2, Math.round(thickness));
        const box: Box = { x0: hole.box.x0 - rim, y0: hole.box.y0 - rim, x1: hole.box.x1 + rim, y1: hole.box.y1 + rim };

        if (countSidesEntered(lineInk, box, thickness) >= 2 && !overlapsAny(discs, box))
        {
            discs.push(box);
        }
    }

    return discs;
}

/**
 * Whether a box overlaps any box of a list.
 *
 * @param boxes - Boxes.
 * @param box - The box.
 * @returns True on overlap.
 */
function overlapsAny(boxes: Array<Box>, box: Box): boolean
{
    for (const other of boxes)
    {
        if (other.x0 < box.x1 && other.x1 > box.x0 && other.y0 < box.y1 && other.y1 > box.y0)
        {
            return true;
        }
    }

    return false;
}

/**
 * Share of a box's pixels that are inked.
 *
 * @param mask - Mask.
 * @param box - The box.
 * @returns A share from 0 to 1.
 */
function measureInkShare(mask: Mask, box: Box): number
{
    const { width, height, data } = mask;
    let count = 0;
    let area = 0;

    for (let y = Math.max(0, box.y0); y < Math.min(height, box.y1); y++)
    {
        for (let x = Math.max(0, box.x0); x < Math.min(width, box.x1); x++)
        {
            count += data[y * width + x];
            area++;
        }
    }

    return area === 0 ? 0 : count / area;
}

/**
 * Counts the sides of a box that line ink enters: a side counts when the band just outside
 * it holds at least a line's thickness of ink.
 *
 * @param lineInk - Line ink.
 * @param box - The box.
 * @param thickness - Line thickness in pixels.
 * @returns Sides entered, 0 to 4.
 */
function countSidesEntered(lineInk: Mask, box: Box, thickness: number): number
{
    const { width, height, data } = lineInk;
    const band = 3;
    const needed = Math.max(2, Math.round(0.6 * thickness * band));

    function countInk(x0: number, y0: number, x1: number, y1: number): number
    {
        let count = 0;

        for (let y = Math.max(0, y0); y < Math.min(height, y1); y++)
        {
            for (let x = Math.max(0, x0); x < Math.min(width, x1); x++)
            {
                count += data[y * width + x];
            }
        }

        return count;
    }

    let sides = 0;
    sides += countInk(box.x0 - band, box.y0, box.x0, box.y1) >= needed ? 1 : 0;
    sides += countInk(box.x1, box.y0, box.x1 + band, box.y1) >= needed ? 1 : 0;
    sides += countInk(box.x0, box.y0 - band, box.x1, box.y0) >= needed ? 1 : 0;
    sides += countInk(box.x0, box.y1, box.x1, box.y1 + band) >= needed ? 1 : 0;

    return sides;
}

/**
 * Replaces each disc by a cross of line thickness, so that the branches meeting under it run
 * on through as lines: the disc itself is cleared, since a run through a solid disc is too
 * thick to pass for a line, and the horizontal arm then spans the disc's width and the
 * vertical its height.
 *
 * @param lineArt - Mask painted in place.
 * @param discs - Disc boxes.
 * @param thickness - Line thickness in pixels.
 */
export function paintCrosses(lineArt: Mask, discs: Array<Box>, thickness: number): void
{
    const half = Math.max(1, Math.round(thickness / 2));

    for (const disc of discs)
    {
        const centerX = Math.round((disc.x0 + disc.x1) / 2);
        const centerY = Math.round((disc.y0 + disc.y1) / 2);

        for (let y = Math.max(0, disc.y0); y < Math.min(lineArt.height, disc.y1); y++)
        {
            for (let x = Math.max(0, disc.x0); x < Math.min(lineArt.width, disc.x1); x++)
            {
                lineArt.data[y * lineArt.width + x] = 0;
            }
        }

        for (let y = Math.max(0, centerY - half); y < Math.min(lineArt.height, centerY + half); y++)
        {
            for (let x = Math.max(0, disc.x0); x < Math.min(lineArt.width, disc.x1); x++)
            {
                lineArt.data[y * lineArt.width + x] = 1;
            }
        }

        for (let y = Math.max(0, disc.y0); y < Math.min(lineArt.height, disc.y1); y++)
        {
            for (let x = Math.max(0, centerX - half); x < Math.min(lineArt.width, centerX + half); x++)
            {
                lineArt.data[y * lineArt.width + x] = 1;
            }
        }
    }
}
