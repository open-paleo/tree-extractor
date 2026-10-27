/**
 * Geometry helpers for working on a region of a figure and mapping results back.
 */

import type { Box, ExtractionDocument, RgbaImage } from "./types.ts";

/**
 * Clamps a box to an image and rounds it to whole pixels.
 *
 * @param box - Requested region.
 * @param width - Image width.
 * @param height - Image height.
 * @returns The usable region, which may be empty.
 */
export function clampBox(box: Box, width: number, height: number): Box
{
    const x0 = Math.max(0, Math.min(width, Math.round(Math.min(box.x0, box.x1))));
    const x1 = Math.max(0, Math.min(width, Math.round(Math.max(box.x0, box.x1))));
    const y0 = Math.max(0, Math.min(height, Math.round(Math.min(box.y0, box.y1))));
    const y1 = Math.max(0, Math.min(height, Math.round(Math.max(box.y0, box.y1))));

    return { x0, y0, x1, y1 };
}

/**
 * Copies a region of an image into a new image.
 *
 * @param image - Source image.
 * @param region - Region to copy, already clamped to the image.
 * @returns The cropped image.
 */
export function cropImage(image: RgbaImage, region: Box): RgbaImage
{
    const width = region.x1 - region.x0;
    const height = region.y1 - region.y0;
    const data = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y++)
    {
        const sourceStart = ((region.y0 + y) * image.width + region.x0) * 4;
        data.set(image.data.subarray(sourceStart, sourceStart + width * 4), y * width * 4);
    }

    return { width, height, data };
}

/**
 * Shifts a box in place.
 *
 * @param box - Box to move.
 * @param dx - Horizontal shift.
 * @param dy - Vertical shift.
 */
function translateBox(box: Box, dx: number, dy: number): void
{
    box.x0 += dx;
    box.x1 += dx;
    box.y0 += dy;
    box.y1 += dy;
}

/**
 * Shifts every coordinate in a document, for results computed on a cropped region that should
 * be expressed in the full image's coordinates.
 *
 * @param document - Document modified in place.
 * @param dx - Horizontal shift.
 * @param dy - Vertical shift.
 */
export function translateDocument(document: ExtractionDocument, dx: number, dy: number): void
{
    for (const segment of document.horizontals)
    {
        translateBox(segment.box, dx, dy);
    }

    for (const segment of document.verticals)
    {
        translateBox(segment.box, dx, dy);
    }

    for (const line of document.textLines)
    {
        translateBox(line.box, dx, dy);
    }

    for (const node of document.nodes)
    {
        node.x += dx;
        node.y0 += dy;
        node.y1 += dy;

        if (node.attachY !== null)
        {
            node.attachY += dy;
        }
    }

    for (const tip of document.tips)
    {
        tip.x += dx;
        tip.y += dy;
    }

    if (document.profile.timeScaled.axis !== null)
    {
        translateBox(document.profile.timeScaled.axis, dx, dy);
    }

    for (const panel of document.profile.panels)
    {
        translateBox(panel, dx, dy);
    }

    if (document.profile.tipAlignment.x !== null)
    {
        document.profile.tipAlignment.x += dx;
    }

    if (document.profile.timeScaled.calibration !== null)
    {
        document.profile.timeScaled.calibration.originX += dx;
    }

    for (const branch of document.branches)
    {
        branch.x0 += dx;
        branch.x1 += dx;
        branch.y += dy;
    }
}
