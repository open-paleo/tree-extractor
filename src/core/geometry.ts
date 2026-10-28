/**
 * Geometry helpers for working on a region of a figure and mapping results back.
 */

import type { Box, ExtractionDocument, Point, RgbaImage, RotatedFrame } from "./types.ts";

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

/**
 * Maps a box from an image's coordinates to those of the same image turned by a number of
 * clockwise quarter turns.
 *
 * @param box - Box in the source image.
 * @param width - Source image width.
 * @param height - Source image height.
 * @param quarterTurns - Clockwise quarter turns, 0 to 3.
 * @returns The box in the turned image.
 */
export function rotateBox(box: Box, width: number, height: number, quarterTurns: number): Box
{
    switch (((quarterTurns % 4) + 4) % 4)
    {
        case 1:
            return { x0: height - box.y1, y0: box.x0, x1: height - box.y0, y1: box.x1 };
        case 2:
            return { x0: width - box.x1, y0: height - box.y1, x1: width - box.x0, y1: height - box.y0 };
        case 3:
            return { x0: box.y0, y0: width - box.x1, x1: box.y1, y1: width - box.x0 };
        default:
            return { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 };
    }
}

/**
 * Builds the frame that turns a zone of the figure by minus an angle, sized to hold the whole
 * turned zone.
 *
 * @param zone - Zone of the figure the frame is for.
 * @param angle - Slant of the labels in radians, positive downward to the right.
 * @returns The frame.
 */
export function createRotatedFrame(zone: Box, angle: number): RotatedFrame
{
    const width = zone.x1 - zone.x0;
    const height = zone.y1 - zone.y0;
    const cosine = Math.abs(Math.cos(angle));
    const sine = Math.abs(Math.sin(angle));
    const frameWidth = Math.ceil(width * cosine + height * sine);
    const frameHeight = Math.ceil(width * sine + height * cosine);

    return {
        angle,
        sourceCenterX: (zone.x0 + zone.x1) / 2,
        sourceCenterY: (zone.y0 + zone.y1) / 2,
        centerX: frameWidth / 2,
        centerY: frameHeight / 2,
        width: frameWidth,
        height: frameHeight,
    };
}

/**
 * Maps a figure point into a turned frame.
 *
 * @param frame - The frame.
 * @param x - Figure x.
 * @param y - Figure y.
 * @returns The point in frame coordinates.
 */
export function mapPointToFrame(frame: RotatedFrame, x: number, y: number): Point
{
    const cosine = Math.cos(-frame.angle);
    const sine = Math.sin(-frame.angle);
    const dx = x - frame.sourceCenterX;
    const dy = y - frame.sourceCenterY;

    return { x: frame.centerX + dx * cosine - dy * sine, y: frame.centerY + dx * sine + dy * cosine };
}

/**
 * Maps a point of a turned frame back into the figure.
 *
 * @param frame - The frame.
 * @param x - Frame x.
 * @param y - Frame y.
 * @returns The point in figure coordinates.
 */
export function mapPointFromFrame(frame: RotatedFrame, x: number, y: number): Point
{
    const cosine = Math.cos(frame.angle);
    const sine = Math.sin(frame.angle);
    const dx = x - frame.centerX;
    const dy = y - frame.centerY;

    return { x: frame.sourceCenterX + dx * cosine - dy * sine, y: frame.sourceCenterY + dx * sine + dy * cosine };
}
