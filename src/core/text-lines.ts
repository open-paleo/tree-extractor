/**
 * Finds rows of text in a figure: removes known line art, takes connected components of what
 * remains as glyphs, and clusters glyphs into lines.
 */

import type { Mask, TextLine } from "./types.ts";
import { compareNumbers, computeMedian, createMaskFromComponents, findConnectedComponents, subtractMask } from "./raster.ts";
import type { Component } from "./raster.ts";

/**
 * Tunable thresholds for text detection.
 */
export type TextLineOptions = {
    /**
     * Pixels known to be line art, which are removed before looking for glyphs.
     */
    lineArtMask: Mask;

    /**
     * Rows above this are ignored (scale bars and axes), in pixels.
     */
    minY: number;
};

/**
 * Result of text detection.
 */
export type TextDetection = {
    /**
     * Text lines found.
     */
    lines: Array<TextLine>;

    /**
     * Upper-quartile glyph height in pixels.
     */
    glyphHeight: number;

    /**
     * Pixels belonging to accepted glyphs.
     */
    glyphMask: Mask;
};

/**
 * A row of text while it is being assembled.
 */
type OpenLine = {
    /**
     * Glyphs clustered so far.
     */
    glyphs: Array<Component>;

    /**
     * Vertical centers of those glyphs.
     */
    centers: Array<number>;

    /**
     * Median of the centers.
     */
    center: number;

    /**
     * Left edge.
     */
    x0: number;

    /**
     * Top edge.
     */
    y0: number;

    /**
     * Right edge.
     */
    x1: number;

    /**
     * Bottom edge.
     */
    y1: number;
};

/**
 * Orders components by left edge.
 *
 * @param left - First component.
 * @param right - Second component.
 * @returns Negative when the first is further left.
 */
function compareComponentLeftEdges(left: Component, right: Component): number
{
    return left.box.x0 - right.box.x0;
}

/**
 * Orders open lines by left edge.
 *
 * @param left - First line.
 * @param right - Second line.
 * @returns Negative when the first is further left.
 */
function compareLineLeftEdges(left: OpenLine, right: OpenLine): number
{
    return left.x0 - right.x0;
}

/**
 * Starts a new line from one glyph.
 *
 * @param glyph - First glyph.
 * @returns The line.
 */
function openLine(glyph: Component): OpenLine
{
    const center = (glyph.box.y0 + glyph.box.y1) / 2;

    return {
        glyphs: [glyph],
        centers: [center],
        center,
        x0: glyph.box.x0,
        y0: glyph.box.y0,
        x1: glyph.box.x1,
        y1: glyph.box.y1,
    };
}

/**
 * Adds a glyph to a line, updating its extent and center.
 *
 * @param line - Line to extend.
 * @param glyph - Glyph to add.
 */
function addGlyph(line: OpenLine, glyph: Component): void
{
    const center = (glyph.box.y0 + glyph.box.y1) / 2;
    line.glyphs.push(glyph);
    line.centers.push(center);
    line.center = computeMedian(line.centers, center);
    line.x0 = Math.min(line.x0, glyph.box.x0);
    line.x1 = Math.max(line.x1, glyph.box.x1);
    line.y0 = Math.min(line.y0, glyph.box.y0);
    line.y1 = Math.max(line.y1, glyph.box.y1);
}

/**
 * Detects text lines in a dark-pixel mask.
 *
 * @param ink - Mask of dark pixels, including colored text.
 * @param options - Thresholds.
 * @returns Text lines, glyph statistics and helper masks.
 */
export function detectTextLines(ink: Mask, options: TextLineOptions): TextDetection
{
    const { width, height } = ink;
    const residue = subtractMask(ink, options.lineArtMask);
    const { components, labels } = findConnectedComponents(residue);
    const plausible = new Array<boolean>(components.length);
    const heights = new Array<number>();

    for (let index = 0; index < components.length; index++)
    {
        const box = components[index].box;
        const glyphWidth = box.x1 - box.x0;
        const componentHeight = box.y1 - box.y0;
        plausible[index] = components[index].area >= 6 && componentHeight >= 3 && componentHeight <= 60 && glyphWidth <= 80 && box.y0 >= options.minY;

        if (plausible[index])
        {
            heights.push(componentHeight);
        }
    }

    // Upper-quartile height: digits, capitals and ascenders set the scale, not dots and dashes.
    heights.sort(compareNumbers);
    const glyphHeight = heights.length === 0 ? 12 : heights[Math.floor(heights.length * 0.7)];
    const selected = new Set<number>();
    const glyphs = new Array<Component>();

    for (let index = 0; index < components.length; index++)
    {
        if (!plausible[index])
        {
            continue;
        }

        const box = components[index].box;
        const glyphWidth = box.x1 - box.x0;
        const componentHeight = box.y1 - box.y0;
        const lineLike = (glyphWidth >= 1.5 * glyphHeight && componentHeight <= 0.4 * glyphHeight)
            || (componentHeight >= 1.5 * glyphHeight && glyphWidth <= 0.4 * glyphHeight);

        if (!lineLike && componentHeight <= 2.5 * glyphHeight && glyphWidth <= 6 * glyphHeight)
        {
            selected.add(index + 1);
            glyphs.push(components[index]);
        }
    }

    glyphs.sort(compareComponentLeftEdges);
    const lines = new Array<OpenLine>();
    const tallGlyphs = new Array<Component>();

    // A descender touching an ascender in the row below fuses two letters into one tall
    // component. Such components are clustered last, into every row they overlap, so neither
    // row is left with a hole wide enough to split a word.
    for (const glyph of glyphs)
    {
        if (glyph.box.y1 - glyph.box.y0 > 1.8 * glyphHeight)
        {
            tallGlyphs.push(glyph);
            continue;
        }

        const center = (glyph.box.y0 + glyph.box.y1) / 2;
        let best: OpenLine | null = null;
        let bestGap = Infinity;

        for (const line of lines)
        {
            const gap = glyph.box.x0 - line.x1;

            if (Math.abs(center - line.center) < 0.5 * glyphHeight && gap < 1.6 * glyphHeight && gap > -8 && gap < bestGap)
            {
                best = line;
                bestGap = gap;
            }
        }

        if (best === null)
        {
            lines.push(openLine(glyph));
        }
        else
        {
            addGlyph(best, glyph);
        }
    }

    for (const glyph of tallGlyphs)
    {
        for (const line of lines)
        {
            const overlap = Math.min(glyph.box.y1, line.y1) - Math.max(glyph.box.y0, line.y0);
            const gap = Math.max(glyph.box.x0 - line.x1, line.x0 - glyph.box.x1);

            if (overlap >= 0.5 * (line.y1 - line.y0) && gap < 1.6 * glyphHeight)
            {
                line.glyphs.push(glyph);
                line.x0 = Math.min(line.x0, glyph.box.x0);
                line.x1 = Math.max(line.x1, glyph.box.x1);
            }
        }
    }

    // Rows that a tall component now bridges are joined.
    lines.sort(compareLineLeftEdges);

    for (let index = 0; index < lines.length; index++)
    {
        for (let other = index + 1; other < lines.length; other++)
        {
            const first = lines[index];
            const second = lines[other];
            const gap = Math.max(second.x0 - first.x1, first.x0 - second.x1);

            if (Math.abs(first.center - second.center) < 0.5 * glyphHeight && gap < 1.6 * glyphHeight)
            {
                first.glyphs.push(...second.glyphs);
                first.centers.push(...second.centers);
                first.center = computeMedian(first.centers, first.center);
                first.x0 = Math.min(first.x0, second.x0);
                first.x1 = Math.max(first.x1, second.x1);
                first.y0 = Math.min(first.y0, second.y0);
                first.y1 = Math.max(first.y1, second.y1);
                lines.splice(other, 1);
                other = index;
            }
        }
    }

    const textLines = new Array<TextLine>();

    for (const line of lines)
    {
        if (line.y1 - line.y0 >= 0.5 * glyphHeight)
        {
            textLines.push({
                id: `l${textLines.length + 1}`,
                box: { x0: line.x0, y0: line.y0, x1: line.x1, y1: line.y1 },
                glyphCount: line.glyphs.length,
                role: "unassigned",
                ocr: null,
            });
        }
    }

    return {
        lines: textLines,
        glyphHeight,
        glyphMask: createMaskFromComponents(labels, selected, width, height),
    };
}
