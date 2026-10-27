/**
 * Things drawn in color or around the figure that the neutral line ink leaves out or lets in
 * wrongly: thin colored lines (branches drawn in color), fat colored shapes (range ovals, clade
 * fills), and the frame some figures draw around themselves.
 */

import type { ExtractionDocument, Mask, QcIssue, RgbaImage, Segment } from "./types.ts";
import { createMaskFromComponents, dilate, erode, findConnectedComponents, subtractMask } from "./raster.ts";

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
function createColoredMask(image: RgbaImage, threshold: number, minChroma: number): Mask
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
 * @returns Number of tips moved.
 */
export function extendTipsThroughMarkers(document: ExtractionDocument, fat: Mask, thickness: number, maxGap: number): number
{
    const { width, height, data } = fat;
    const half = Math.max(1, Math.round(thickness));
    let moved = 0;

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

        if (end > tip.x + 2)
        {
            tip.extendedFrom ??= tip.x;
            tip.x = end + 1;
            moved++;
        }
    }

    return moved;
}
