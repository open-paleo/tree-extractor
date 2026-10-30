/**
 * Finds rows of text in a figure: removes known line art, takes connected components of what
 * remains as glyphs, and clusters glyphs into lines.
 */

import type { Box, Mask, TextLine } from "./types.ts";
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

    /**
     * Fat colored shapes: range bars and markers. A glyph lying on one is a block, not text,
     * however hollow it reads once the line art is taken out of it.
     */
    markerMask?: Mask;
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

    /**
     * Whether glyph components came out much shorter than the row spacing implies, the sign of a
     * thin font breaking into fragments at the ink threshold.
     */
    fragmented: boolean;
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
 * The box of a row's text: its glyphs without any solid block among them. A range bar or a
 * wedge touching a label joins the row as a glyph, which keeps the row whole and its pixels
 * out of the line ink, but the box that places the label and clips branches must not reach
 * over the bar. A letter never fills its box; a bar does.
 *
 * @param line - Open row.
 * @param glyphHeight - Glyph height in pixels.
 * @param markerMask - Fat colored shapes, when known.
 * @returns The box of the non-solid glyphs, or of all glyphs when every one is solid.
 */
function measureTextBox(line: OpenLine, glyphHeight: number, markerMask: Mask | undefined): Box
{
    // The row keeps its own height: a fused tall glyph widens a row without stretching it, and
    // the box here only loses the columns of solid blocks.
    let x0 = Infinity;
    let x1 = -Infinity;

    for (const glyph of line.glyphs)
    {
        const width = glyph.box.x1 - glyph.box.x0;
        const height = glyph.box.y1 - glyph.box.y0;
        // A block that fills its box: a bar of any height, as long as it is wider than a letter.
        // An outlined range bar reads hollow once its edges are taken out as line art, but its
        // colored fill is a fat marker, and a glyph as wide as a bar lying mostly on one is one,
        // unless the marker goes on all around it: then it is a letter on a colored panel.
        const filled = glyph.area >= 0.85 * width * height && (height >= 0.8 * glyphHeight || width >= 1.5 * glyphHeight);
        const solid = width >= 1.2 * glyphHeight && (filled || (markerMask !== undefined && liesOnMarker(markerMask, glyph, glyphHeight)));

        if (!solid)
        {
            x0 = Math.min(x0, glyph.box.x0);
            x1 = Math.max(x1, glyph.box.x1);
        }
    }

    return Number.isFinite(x0) ? { x0, y0: line.y0, x1, y1: line.y1 } : { x0: line.x0, y0: line.y0, x1: line.x1, y1: line.y1 };
}

/**
 * Whether a glyph lies on a fat colored shape of its own size: the shape covers most of the
 * glyph and little of a margin around it. A letter on a colored panel has the panel all
 * around it as well.
 *
 * @param markerMask - Fat colored shapes.
 * @param glyph - The glyph.
 * @param glyphHeight - Glyph height in pixels.
 * @returns True for a glyph that is itself a bar or a marker.
 */
function liesOnMarker(markerMask: Mask, glyph: Component, glyphHeight: number): boolean
{
    if (countMaskInBox(markerMask, glyph.box) < 0.5 * glyph.area)
    {
        return false;
    }

    const margin = Math.max(3, Math.round(glyphHeight / 3));
    const grown: Box = { x0: glyph.box.x0 - margin, y0: glyph.box.y0 - margin, x1: glyph.box.x1 + margin, y1: glyph.box.y1 + margin };
    const ringArea = (grown.x1 - grown.x0) * (grown.y1 - grown.y0) - (glyph.box.x1 - glyph.box.x0) * (glyph.box.y1 - glyph.box.y0);
    const ringInk = countMaskInBox(markerMask, grown) - countMaskInBox(markerMask, glyph.box);

    return ringInk <= 0.3 * ringArea;
}

/**
 * Counts the set pixels of a mask within a box.
 *
 * @param mask - Mask.
 * @param box - Box.
 * @returns Set pixels.
 */
function countMaskInBox(mask: Mask, box: Box): number
{
    let count = 0;

    for (let y = Math.max(0, box.y0); y < Math.min(mask.height, box.y1); y++)
    {
        for (let x = Math.max(0, box.x0); x < Math.min(mask.width, box.x1); x++)
        {
            count += mask.data[y * mask.width + x];
        }
    }

    return count;
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
 * Estimates the vertical spacing of text rows from the gaps between row centers. Tip labels sit
 * on evenly spaced rows in almost every tree figure, and fragments of one row share a center,
 * so the median gap is the spacing even when rows are broken into pieces.
 *
 * @param lines - Rows from a first clustering pass.
 * @param glyphHeight - Provisional glyph height, for telling fragments of one row apart.
 * @returns The spacing in pixels, or null when there are too few rows.
 */
function estimateRowPitch(lines: Array<OpenLine>, glyphHeight: number): number | null
{
    const centers = new Array<number>();

    for (const line of lines)
    {
        if (line.glyphs.length >= 3)
        {
            centers.push(line.center);
        }
    }

    centers.sort(compareNumbers);

    // Fragments of one row (ascender pieces, x-height pieces) have centers a few pixels apart;
    // they are one row for this purpose, so centers closer than a fraction of a glyph merge.
    const rows = new Array<number>();

    for (const center of centers)
    {
        if (rows.length === 0 || center - rows[rows.length - 1] >= 0.6 * glyphHeight)
        {
            rows.push(center);
        }
    }

    const gaps = new Array<number>();

    for (let index = 1; index < rows.length; index++)
    {
        gaps.push(rows[index] - rows[index - 1]);
    }

    return gaps.length < 4 ? null : computeMedian(gaps, 0);
}

/**
 * Glyph components chosen for a glyph height.
 */
type GlyphSelection = {
    /**
     * The glyphs, in left-to-right order.
     */
    glyphs: Array<Component>;

    /**
     * Their 1-based component labels.
     */
    labels: Set<number>;

    /**
     * Thin uprights of about a letter's height: an ascender or a short connector. They join a
     * row that reaches them but never start one, and they are not glyphs for the mask.
     */
    uprights: Array<Component>;
};

/**
 * Keeps the plausible components that are glyph-sized for the given glyph height and are not
 * line-like.
 *
 * @param components - All components of the residue.
 * @param plausible - Which components passed the coarse size filter.
 * @param glyphHeight - Glyph height in pixels.
 * @returns The glyphs and their labels.
 */
function selectGlyphs(components: Array<Component>, plausible: Array<boolean>, glyphHeight: number): GlyphSelection
{
    const labels = new Set<number>();
    const glyphs = new Array<Component>();
    const uprights = new Array<Component>();

    for (let index = 0; index < components.length; index++)
    {
        if (!plausible[index])
        {
            continue;
        }

        const box = components[index].box;
        const glyphWidth = box.x1 - box.x0;
        const componentHeight = box.y1 - box.y0;
        const upright = componentHeight >= 1.5 * glyphHeight && glyphWidth <= 0.4 * glyphHeight;

        if (upright && componentHeight <= 2.5 * glyphHeight)
        {
            uprights.push(components[index]);
        }

        // A dash much longer than a hyphen and no thicker than a line is a branch stub, not a glyph.
        const lineLike = (glyphWidth >= 1.5 * glyphHeight && componentHeight <= 0.4 * glyphHeight)
            || upright
            || (glyphWidth >= 0.75 * glyphHeight && componentHeight <= 0.3 * glyphHeight && glyphWidth >= 3 * componentHeight);

        // Touching letters make one component per word, so a glyph may be a word wide.
        if (!lineLike && componentHeight <= 2.5 * glyphHeight && glyphWidth <= 20 * glyphHeight)
        {
            labels.add(index + 1);
            glyphs.push(components[index]);
        }
    }

    glyphs.sort(compareComponentLeftEdges);

    return { glyphs, labels, uprights };
}

/**
 * Clusters glyphs into rows of text.
 *
 * @param glyphs - Glyphs sorted left to right.
 * @param uprights - Thin uprights that may extend a row but never start one.
 * @param glyphHeight - Glyph height in pixels, which scales every tolerance.
 * @returns Open lines, merged where a tall fused component bridges two pieces of a row.
 */
function clusterIntoLines(glyphs: Array<Component>, uprights: Array<Component>, glyphHeight: number): Array<OpenLine>
{
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

    // An ascender in a tall-lettered font looks like a short connector and is kept out of the
    // glyphs. One with text on both sides is a letter in a word, so the row takes it in rather
    // than being cut there; a connector has text on its right at most.
    for (const upright of uprights)
    {
        let left: OpenLine | null = null;
        let right: OpenLine | null = null;

        for (const line of lines)
        {
            const overlap = Math.min(upright.box.y1, line.y1) - Math.max(upright.box.y0, line.y0);

            if (overlap < 0.5 * (line.y1 - line.y0))
            {
                continue;
            }

            if (line.x1 <= upright.box.x1 && upright.box.x0 - line.x1 < 1.6 * glyphHeight)
            {
                left = line;
            }
            else if (line.x0 >= upright.box.x0 && line.x0 - upright.box.x1 < 1.6 * glyphHeight)
            {
                right = line;
            }
        }

        if (left !== null && right !== null)
        {
            left.glyphs.push(upright);
            left.x0 = Math.min(left.x0, upright.box.x0);
            left.x1 = Math.max(left.x1, upright.box.x1);
        }
    }

    // Rows that a tall component now bridges are joined, and so are pieces of one row whose
    // centers only agree once a piece seeded by a dot or a serif has taken in real letters.
    // Joining shifts centers, so the pass repeats until nothing joins.
    lines.sort(compareLineLeftEdges);
    let joined = true;

    while (joined)
    {
        joined = false;

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
                    joined = true;
                }
            }
        }
    }

    return lines;
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
        plausible[index] = components[index].area >= 6 && componentHeight >= 3 && componentHeight <= 60 && glyphWidth <= 400 && box.y0 >= options.minY;

        if (plausible[index])
        {
            heights.push(componentHeight);
        }
    }

    // Upper-quartile height: digits, capitals and ascenders set the scale, not dots and dashes.
    // Thin fonts break into fragments shorter than a letter, which drags that down, so the
    // spacing of the label rows, which fragmentation cannot change, sets a floor.
    heights.sort(compareNumbers);
    let glyphHeight = heights.length === 0 ? 12 : heights[Math.floor(heights.length * 0.7)];
    let selected = selectGlyphs(components, plausible, glyphHeight);
    let lines = clusterIntoLines(selected.glyphs, selected.uprights, glyphHeight);
    const pitch = estimateRowPitch(lines, glyphHeight);
    const floor = pitch === null ? 0 : Math.round(0.45 * pitch);
    const fragmented = floor > glyphHeight + 1;

    if (fragmented)
    {
        glyphHeight = floor;
        selected = selectGlyphs(components, plausible, glyphHeight);
        lines = clusterIntoLines(selected.glyphs, selected.uprights, glyphHeight);
    }

    const textLines = new Array<TextLine>();

    for (const line of lines)
    {
        if (line.y1 - line.y0 >= 0.5 * glyphHeight)
        {
            textLines.push({
                id: `l${textLines.length + 1}`,
                box: measureTextBox(line, glyphHeight, options.markerMask),
                glyphCount: line.glyphs.length,
                role: "unassigned",
                ocr: null,
            });
        }
    }

    return {
        lines: textLines,
        glyphHeight,
        glyphMask: createMaskFromComponents(labels, selected.labels, width, height),
        fragmented,
    };
}
