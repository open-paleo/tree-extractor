/**
 * Figure profile: a handful of figure-level properties measured once per extraction. This step
 * only measures and records; nothing in the pipeline reads the profile yet. Every measurement
 * works from data the pipeline already has, and every voted feature has an unknown value for
 * when the vote is close.
 */

import type {
    Box,
    CladeMark,
    ExtractionDocument,
    FigureProfile,
    FontProfile,
    LayoutKind,
    Mask,
    ProfileOverrides,
    RgbaImage,
    SupportLabelStyle,
    TextLine,
    TimeScaleProfile,
    TipAlignment,
    TreeNode,
} from "./types.ts";
import { compareNumbers, computeMedian, createMaskFromBoxes, dilate, erode, findConnectedComponents, unionMask } from "./raster.ts";
import { collectConnected } from "./tree.ts";
import { findAxis } from "./timescale.ts";

/**
 * Share of tips that must end at one x for the tips to count as aligned.
 */
const alignedShare = 0.8;

/**
 * Smallest glyph height at which the slant is measured.
 */
const smallestSlantGlyph = 11;

/**
 * Everything the profile is measured from.
 */
export type ProfileInput = {
    /**
     * The analyzed image (the region, when one was set).
     */
    image: RgbaImage;

    /**
     * Dark pixels at the text threshold.
     */
    textInk: Mask;

    /**
     * Line ink after glyph removal.
     */
    lineInk: Mask;

    /**
     * Glyph pixels from the rough text pass.
     */
    glyphMask: Mask;

    /**
     * Glyph height in pixels.
     */
    glyphHeight: number;

    /**
     * Line thickness in pixels.
     */
    thickness: number;

    /**
     * Whether the strict text threshold broke letters into fragments.
     */
    fragmented: boolean;

    /**
     * Whether the text ink was widened by hysteresis.
     */
    widened: boolean;

    /**
     * Collinear segment pairs joined across a gap.
     */
    bridgedGaps: number;

    /**
     * The document after tracing and label assignment.
     */
    document: ExtractionDocument;
};

/**
 * A profile with nothing measured, for documents built before measurement or by hand.
 *
 * @returns An all-unknown profile.
 */
export function createEmptyProfile(): FigureProfile
{
    return {
        orientation: "root-left",
        lineThickness: 0,
        layout: "unknown",
        tipAlignment: { aligned: false, x: null, share: 0 },
        supportLabels: "unknown",
        cladeMarks: [],
        font: { strokeWidth: 0, letterGap: 0, slant: null, italic: null, letterSpaced: false, fragmented: false, widened: false, condensing: 1 },
        timeScaled: { tintedShare: 0, bandColumnShare: 0, bands: false, axis: null, ticks: 0, calibration: null, rangeBars: 0 },
        panels: [],
        bridgedGaps: 0,
        confidence: { layout: 0, tipAlignment: 0, supportLabels: 0 },
        overridden: [],
    };
}

/**
 * Measures the profile of a figure. Runs before labels are read; the parts that depend on the
 * read text are filled by measureTextMarks afterwards.
 *
 * @param input - Image, masks and document.
 * @returns The measured profile.
 */
export function measureProfile(input: ProfileInput): FigureProfile
{
    const { document, glyphHeight, thickness } = input;
    const connected = collectConnected(document);
    const layout = measureLayout(document.nodes, connected, thickness);
    const tipAlignment = measureTipAlignment(document, connected, glyphHeight);
    const font = measureFont(input.glyphMask, input.textInk, document.textLines, glyphHeight);
    font.fragmented = input.fragmented;
    font.widened = input.widened;
    const profile: FigureProfile = {
        orientation: "root-left",
        lineThickness: thickness,
        layout: layout.value,
        tipAlignment,
        supportLabels: "unknown",
        cladeMarks: [],
        font,
        timeScaled: measureTimeScale(input, connected),
        panels: findPanels(input.lineInk, document, glyphHeight, thickness),
        bridgedGaps: input.bridgedGaps,
        confidence: {
            layout: layout.confidence,
            tipAlignment: Math.min(1, Math.abs(tipAlignment.share - alignedShare) / 0.2),
            supportLabels: 0,
        },
        overridden: [],
    };
    measureTextMarks(profile, document, input.textInk, glyphHeight);

    return profile;
}

/**
 * Fills the parts of a profile that read text can change: the support label style, whose vote
 * leaves out rows that read as one capital letter, and the clade marks. Called once before
 * labels are read and again after.
 *
 * @param profile - Profile updated in place.
 * @param document - Document.
 * @param textInk - Dark pixels at the text threshold.
 * @param glyphHeight - Glyph height in pixels.
 */
export function measureTextMarks(profile: FigureProfile, document: ExtractionDocument, textInk: Mask, glyphHeight: number): void
{
    if (!profile.overridden.includes("supportLabels"))
    {
        const supportLabels = measureSupportLabels(document, glyphHeight);
        profile.supportLabels = supportLabels.value;
        profile.confidence.supportLabels = supportLabels.confidence;
    }

    profile.cladeMarks = measureCladeMarks(document, textInk, glyphHeight);
}

/**
 * Horizontal factor for label crops before OCR: letters a quarter of a glyph height or more
 * apart are brought back to about an eighth, down to a floor of 0.55.
 *
 * @param letterGap - Typical blank gap between letters, as a fraction of the glyph height.
 * @returns Factor from 0.55 to 1.
 */
export function chooseCondensing(letterGap: number): number
{
    if (letterGap < 0.25)
    {
        return 1;
    }

    return Math.max(0.55, 0.12 / letterGap);
}

/**
 * Replaces measured values with the caller's, recording which.
 *
 * @param profile - Profile modified in place.
 * @param overrides - Values to fix.
 */
export function applyProfileOverrides(profile: FigureProfile, overrides: ProfileOverrides): void
{
    function record(name: string): void
    {
        if (!profile.overridden.includes(name))
        {
            profile.overridden.push(name);
        }
    }

    if (overrides.layout !== undefined)
    {
        profile.layout = overrides.layout;
        profile.confidence.layout = 1;
        record("layout");
    }

    if (overrides.supportLabels !== undefined)
    {
        profile.supportLabels = overrides.supportLabels;
        profile.confidence.supportLabels = 1;
        record("supportLabels");
    }

    if (overrides.tipsAligned !== undefined)
    {
        profile.tipAlignment.aligned = overrides.tipsAligned;
        profile.confidence.tipAlignment = 1;
        record("tipAlignment");
    }

    if (overrides.italic !== undefined)
    {
        profile.font.italic = overrides.italic;
        record("font.italic");
    }

    if (overrides.widenText !== undefined)
    {
        // The widening itself happened while the masks were made; this records the choice.
        record("font.widened");
    }

    if (overrides.condensing !== undefined)
    {
        profile.font.condensing = Math.min(1, Math.max(0.55, overrides.condensing));
        record("font.condensing");
    }
}

/**
 * A voted value with its margin.
 */
type Vote<T> = {
    /**
     * Winning value.
     */
    value: T;

    /**
     * Margin from 0 to 1.
     */
    confidence: number;
};

/**
 * Layout family from where parent branches meet their verticals: at an end (staircase) or
 * inside the span (centered). Only nodes in the tree with a parent and a span longer than two
 * line thicknesses vote.
 *
 * @param nodes - All nodes.
 * @param connected - Identifiers of elements in the main tree.
 * @param thickness - Line thickness in pixels.
 * @returns The layout vote.
 */
export function measureLayout(nodes: Array<TreeNode>, connected: Set<string>, thickness: number): Vote<LayoutKind>
{
    let atEnd = 0;
    let inside = 0;

    for (const node of nodes)
    {
        const span = node.y1 - node.y0;

        if (!connected.has(node.id) || node.parent === null || node.attachY === null || span <= 2 * thickness)
        {
            continue;
        }

        const position = (node.attachY - node.y0) / span;

        if (position <= 0.12 || position >= 0.88)
        {
            atEnd++;
        }
        else
        {
            inside++;
        }
    }

    const total = atEnd + inside;

    if (total < 3)
    {
        return { value: "unknown", confidence: 0 };
    }

    const endShare = atEnd / total;

    if (endShare >= 0.6)
    {
        return { value: "staircase", confidence: Math.min(1, (endShare - 0.5) / 0.4) };
    }

    if (endShare <= 0.4)
    {
        return { value: "centered", confidence: Math.min(1, (0.5 - endShare) / 0.4) };
    }

    return { value: "unknown", confidence: 0 };
}

/**
 * Whether the tips of the main tree end on one vertical line.
 *
 * @param document - Document.
 * @param connected - Identifiers of elements in the main tree.
 * @param glyphHeight - Glyph height in pixels.
 * @returns The alignment.
 */
export function measureTipAlignment(document: ExtractionDocument, connected: Set<string>, glyphHeight: number): TipAlignment
{
    const xs = new Array<number>();

    for (const tip of document.tips)
    {
        if (connected.has(tip.id))
        {
            xs.push(tip.x);
        }
    }

    if (xs.length < 3)
    {
        return { aligned: false, x: null, share: 0 };
    }

    xs.sort(compareNumbers);
    const reach = 0.5 * glyphHeight;
    let bestCount = 0;
    let bestStart = 0;

    // The densest window of tip ends, half a glyph height wide.
    for (let start = 0, end = 0; start < xs.length; start++)
    {
        while (end < xs.length && xs[end] - xs[start] <= reach)
        {
            end++;
        }

        if (end - start > bestCount)
        {
            bestCount = end - start;
            bestStart = start;
        }
    }

    const share = bestCount / xs.length;
    const aligned = share >= alignedShare;
    const x = aligned ? computeMedian(xs.slice(bestStart, bestStart + bestCount), xs[bestStart]) : null;

    return { aligned, x, share };
}

/**
 * Classifies one node label by where it sits relative to its junction.
 *
 * @param node - Node that owns the label.
 * @param line - The label's text row.
 * @param glyphHeight - Glyph height in pixels.
 * @returns The style the placement suggests.
 */
export function classifySupportLabel(node: TreeNode, line: TextLine, glyphHeight: number): SupportLabelStyle
{
    const junctionY = node.attachY ?? (node.y0 + node.y1) / 2;
    const { box } = line;
    const leftOfVertical = box.x1 <= node.x + 2;

    if (leftOfVertical && box.y0 < junctionY && box.y1 > junctionY)
    {
        return "boxed-on-branch";
    }

    if (box.y1 <= junctionY + 2 && box.x1 <= node.x + glyphHeight)
    {
        return "above-branch";
    }

    return "at-node";
}

/**
 * Support label style by majority over the labelled nodes of the figure.
 *
 * @param document - Document after label assignment.
 * @param glyphHeight - Glyph height in pixels.
 * @returns The style vote.
 */
export function measureSupportLabels(document: ExtractionDocument, glyphHeight: number): Vote<SupportLabelStyle>
{
    const lineById = new Map<string, TextLine>();

    for (const line of document.textLines)
    {
        lineById.set(line.id, line);
    }

    const counts = new Map<SupportLabelStyle, number>();
    let total = 0;

    for (const node of document.nodes)
    {
        const line = node.textLine === null ? undefined : lineById.get(node.textLine);

        if (line === undefined || isSingleLetter(line))
        {
            continue;
        }

        const style = classifySupportLabel(node, line, glyphHeight);
        counts.set(style, (counts.get(style) ?? 0) + 1);
        total++;
    }

    if (total < 3)
    {
        return { value: "none", confidence: total === 0 ? 1 : 0.5 };
    }

    let best: SupportLabelStyle = "unknown";
    let bestCount = 0;

    for (const [style, count] of counts)
    {
        if (count > bestCount)
        {
            best = style;
            bestCount = count;
        }
    }

    const share = bestCount / total;

    return { value: share >= 0.5 ? best : "unknown", confidence: Math.min(1, Math.max(0, (share - 0.5) / 0.4)) };
}

/**
 * Whether a text row reads as one capital letter.
 *
 * @param line - Text row.
 * @returns True for a single letter.
 */
function isSingleLetter(line: TextLine): boolean
{
    return line.ocr !== null && /^[A-Z]$/.test(line.ocr.text.trim());
}

/**
 * Clade marks: single capital letters at junctions, and filled discs of about a glyph's size.
 *
 * @param document - Document after label reading.
 * @param textInk - Dark pixels at the text threshold.
 * @param glyphHeight - Glyph height in pixels.
 * @returns The marks found.
 */
export function measureCladeMarks(document: ExtractionDocument, textInk: Mask, glyphHeight: number): Array<CladeMark>
{
    const marks = new Array<CladeMark>();
    let letters = 0;

    for (const line of document.textLines)
    {
        if (line.role === "node" && isSingleLetter(line))
        {
            letters++;
        }
    }

    if (letters >= 3)
    {
        marks.push("letters");
    }

    if (countDiscs(textInk, glyphHeight) >= 3)
    {
        marks.push("discs");
    }

    return marks;
}

/**
 * Counts filled, round blobs of about a glyph's size. The ink is eroded first so that lines and
 * letter strokes vanish and a disc sitting on a branch comes apart from it.
 *
 * @param ink - Mask to search.
 * @param glyphHeight - Glyph height in pixels.
 * @returns Number of discs.
 */
function countDiscs(ink: Mask, glyphHeight: number): number
{
    const radius = Math.max(1, Math.round(0.12 * glyphHeight));
    const { components } = findConnectedComponents(erode(ink, radius));
    let discs = 0;

    for (const component of components)
    {
        const width = component.box.x1 - component.box.x0;
        const height = component.box.y1 - component.box.y0;

        if (width < 0.6 * glyphHeight || width > 3 * glyphHeight || height < 0.6 * glyphHeight || height > 3 * glyphHeight)
        {
            continue;
        }

        // A disc fills about 0.79 of its box; a rectangle (a range bar) fills all of it.
        const aspect = width / height;
        const fill = component.area / (width * height);

        if (aspect >= 0.8 && aspect <= 1.25 && fill >= 0.65 && fill <= 0.88)
        {
            discs++;
        }
    }

    return discs;
}

/**
 * Font properties: stroke width from run lengths, letter gap from blank columns in long rows,
 * slant from the lean of tall glyphs.
 *
 * @param glyphMask - Glyph pixels.
 * @param textInk - Dark pixels at the text threshold.
 * @param lines - Text rows.
 * @param glyphHeight - Glyph height in pixels.
 * @returns The font profile.
 */
export function measureFont(glyphMask: Mask, textInk: Mask, lines: Array<TextLine>, glyphHeight: number): FontProfile
{
    const strokeWidth = Math.min(measureRunMedian(glyphMask, true), measureRunMedian(glyphMask, false));
    const letterGap = measureLetterGap(textInk, lines, glyphHeight);
    // Below about eleven pixels an italic lean is a pixel or less across a letter and the
    // measurement says nothing, so it is not made.
    const slant = glyphHeight < smallestSlantGlyph ? null : measureSlant(glyphMask, lines, glyphHeight);

    return {
        strokeWidth,
        letterGap,
        slant,
        italic: slant === null ? null : slant >= 0.12,
        letterSpaced: letterGap >= 0.4,
        fragmented: false,
        widened: false,
        condensing: chooseCondensing(letterGap),
    };
}

/**
 * Whether a text row is long enough to say something about the font: at least six glyph
 * heights wide, which a taxon name always is and a support value never. Width rather than the
 * glyph count, since touching letters make one glyph of a whole word.
 *
 * @param line - Text row.
 * @param glyphHeight - Glyph height in pixels.
 * @returns True for a long row.
 */
function isLongRow(line: TextLine, glyphHeight: number): boolean
{
    return line.box.x1 - line.box.x0 >= 6 * glyphHeight;
}

/**
 * Median run length of set pixels along rows or columns, counting runs.
 *
 * @param mask - Mask to measure.
 * @param alongX - Whether to scan rows (true) or columns (false).
 * @returns The median run length, or 0 for an empty mask.
 */
function measureRunMedian(mask: Mask, alongX: boolean): number
{
    const { width, height, data } = mask;
    const outer = alongX ? height : width;
    const inner = alongX ? width : height;
    const histogram = new Array<number>(inner + 1).fill(0);
    let total = 0;

    for (let a = 0; a < outer; a++)
    {
        let start = -1;

        for (let b = 0; b <= inner; b++)
        {
            const index = alongX ? a * width + b : b * width + a;
            const on = b < inner && data[index] === 1;

            if (on && start < 0)
            {
                start = b;
            }
            else if (!on && start >= 0)
            {
                histogram[b - start]++;
                total++;
                start = -1;
            }
        }
    }

    let seen = 0;

    for (let length = 1; length <= inner; length++)
    {
        seen += histogram[length];

        if (seen * 2 >= total)
        {
            return total === 0 ? 0 : length;
        }
    }

    return 0;
}

/**
 * Typical blank gap between letters in long rows, as a fraction of the glyph height.
 *
 * @param textInk - Dark pixels at the text threshold.
 * @param lines - Text rows; long rows count.
 * @param glyphHeight - Glyph height in pixels.
 * @returns The gap fraction, or 0 when no row is long enough.
 */
function measureLetterGap(textInk: Mask, lines: Array<TextLine>, glyphHeight: number): number
{
    const gaps = new Array<number>();

    for (const line of lines)
    {
        if (!isLongRow(line, glyphHeight))
        {
            continue;
        }

        let gap = 0;
        let seenInk = false;

        for (let x = line.box.x0; x < line.box.x1; x++)
        {
            let inked = false;

            for (let y = line.box.y0; y < line.box.y1 && !inked; y++)
            {
                inked = textInk.data[y * textInk.width + x] === 1;
            }

            if (inked)
            {
                if (seenInk && gap > 0)
                {
                    gaps.push(gap);
                }

                seenInk = true;
                gap = 0;
            }
            else
            {
                gap++;
            }
        }
    }

    gaps.sort(compareNumbers);

    return gaps.length === 0 ? 0 : computeMedian(gaps, 0) / glyphHeight;
}

/**
 * Slant of the text: the median over long text rows of the shear that makes the row's vertical
 * projection sharpest. Upright stems stack into narrow columns at zero shear; italic
 * stems do so once the shear undoes their lean. Rows are projected separately, since the rows
 * of a figure are not aligned with one another, and whole words work as well as single letters.
 *
 * @param glyphMask - Glyph pixels.
 * @param lines - Text rows; long rows count.
 * @param glyphHeight - Glyph height in pixels.
 * @returns Horizontal shift per unit height, positive for a rightward lean; null with fewer than
 * three long rows.
 */
export function measureSlant(glyphMask: Mask, lines: Array<TextLine>, glyphHeight: number): number | null
{
    const { width, data } = glyphMask;
    const shears = [-0.08, -0.04, 0, 0.04, 0.08, 0.12, 0.16, 0.2, 0.24, 0.28, 0.32, 0.36, 0.4];
    const rowSlants = new Array<number>();

    for (const line of lines)
    {
        if (!isLongRow(line, glyphHeight))
        {
            continue;
        }

        // Each pixel is split between the two bins its sheared position falls between, since a
        // lean of 0.2 over a 12-pixel row shifts the top by only 2.4 pixels and rounding the
        // shift to whole pixels would hide the difference between neighboring shears.
        const { box } = line;
        const boxHeight = box.y1 - box.y0;
        const pad = Math.ceil(0.4 * boxHeight) + 2;
        const span = box.x1 - box.x0 + 2 * pad;
        const histogram = new Float64Array(span);
        const scores = new Array<number>(shears.length).fill(0);
        let count = 0;

        for (let index = 0; index < shears.length; index++)
        {
            histogram.fill(0);
            count = 0;

            // A rightward lean puts the top of a stem right of its foot; shifting each row left
            // by the lean times its height above the baseline stands the stem up again.
            for (let y = box.y0; y < box.y1; y++)
            {
                const shift = shears[index] * (box.y1 - y);
                const whole = Math.floor(shift);
                const fraction = shift - whole;

                for (let x = box.x0; x < box.x1; x++)
                {
                    if (data[y * width + x] === 1)
                    {
                        const bin = x - box.x0 + pad - whole;
                        histogram[bin] += 1 - fraction;
                        histogram[bin - 1] += fraction;
                        count++;
                    }
                }
            }

            // Sharpness over pairs of neighboring bins, so that a pixel split between two bins
            // by the fractional shift counts in full and zero shear, which never splits, gets
            // no advantage.
            let sharpness = 0;

            for (let column = 0; column + 1 < span; column++)
            {
                const pair = histogram[column] + histogram[column + 1];
                sharpness += pair * pair;
            }

            scores[index] = sharpness;
        }

        let best = 0;

        for (let index = 1; index < shears.length; index++)
        {
            if (scores[index] > scores[best])
            {
                best = index;
            }
        }

        if (count > 0)
        {
            rowSlants.push(shears[best]);
        }
    }

    // The median over rows: a row of short words or a row the glyph mask broke oddly can vote
    // for anything, and the sum of scores lets such rows outweigh the clear ones.
    if (rowSlants.length < 3)
    {
        return null;
    }

    rowSlants.sort(compareNumbers);

    return computeMedian(rowSlants, 0);
}

/**
 * Signs of a time scale: tinted background, an axis along the top or bottom, range bars.
 *
 * @param input - Image, masks and document.
 * @param connected - Identifiers of elements in the main tree.
 * @returns The time-scale profile.
 */
function measureTimeScale(input: ProfileInput, connected: Set<string>): TimeScaleProfile
{
    const tint = measureTint(input.image);
    const axis = findAxis(input.document, input.textInk, input.glyphHeight, input.thickness);

    return {
        tintedShare: tint.share,
        bandColumnShare: tint.bandColumnShare,
        bands: tint.bandColumnShare >= 0.15,
        axis: axis === null ? null : axis.box,
        ticks: axis === null ? 0 : axis.ticks.length,
        calibration: null,
        rangeBars: countRangeBars(input.document, input.textInk, connected, input.glyphHeight),
    };
}

/**
 * How much of an image is tinted.
 */
type TintMeasure = {
    /**
     * Share of all pixels that are neither white nor ink.
     */
    share: number;

    /**
     * Share of columns tinted over at least sixty percent of their height.
     */
    bandColumnShare: number;
};

/**
 * Measures the pixels that are neither white nor ink, overall and per column.
 *
 * @param image - Image.
 * @returns The tint measure.
 */
function measureTint(image: RgbaImage): TintMeasure
{
    const { data, width, height } = image;
    const columnCounts = new Array<number>(width).fill(0);
    let tinted = 0;

    for (let y = 0; y < height; y++)
    {
        for (let x = 0; x < width; x++)
        {
            const index = (y * width + x) * 4;
            const r = data[index];
            const g = data[index + 1];
            const b = data[index + 2];
            const low = Math.min(r, g, b);
            const high = Math.max(r, g, b);
            const luminance = (r * 299 + g * 587 + b * 114) / 1000;
            // Pale bands sit just under 248 in their weakest channel; JPEG white stays above.
            const white = low >= 248;
            const ink = luminance < 200 && high - low <= 40;

            if (!white && !ink)
            {
                tinted++;
                columnCounts[x]++;
            }
        }
    }

    let bandColumns = 0;

    for (const count of columnCounts)
    {
        if (count >= 0.6 * height)
        {
            bandColumns++;
        }
    }

    const pixels = width * height;

    return { share: pixels === 0 ? 0 : tinted / pixels, bandColumnShare: width === 0 ? 0 : bandColumns / width };
}

/**
 * Counts tip branches that end in a range bar: the ink across the branch is clearly taller near
 * the right end than along the left part of the same segment.
 *
 * @param document - Document.
 * @param textInk - Dark pixels at the text threshold, which include the bars.
 * @param connected - Identifiers of elements in the main tree.
 * @param glyphHeight - Glyph height in pixels.
 * @returns Number of range bars.
 */
function countRangeBars(document: ExtractionDocument, textInk: Mask, connected: Set<string>, glyphHeight: number): number
{
    let bars = 0;

    for (const segment of document.horizontals)
    {
        const { box } = segment;
        const length = box.x1 - box.x0;

        if (length < 3 * glyphHeight)
        {
            continue;
        }

        let endsAtTip = false;

        for (const tip of document.tips)
        {
            if (connected.has(tip.id) && Math.abs(tip.x - box.x1) <= glyphHeight && tip.y >= box.y0 - 1 && tip.y <= box.y1 + 1)
            {
                endsAtTip = true;
                break;
            }
        }

        if (!endsAtTip)
        {
            continue;
        }

        const window = Math.round(glyphHeight / 2);
        const leftHeight = measureInkHeight(textInk, box.x0 + 2, box.x0 + Math.round(0.3 * length), box.y0 - window, box.y1 + window);
        const rightHeight = measureInkHeight(textInk, box.x1 - Math.round(0.2 * length), box.x1 - 2, box.y0 - window, box.y1 + window);

        if (leftHeight > 0 && rightHeight >= 1.6 * leftHeight && rightHeight >= leftHeight + 3)
        {
            bars++;
        }
    }

    return bars;
}

/**
 * Median number of ink pixels per column over a range of columns and rows.
 *
 * @param ink - Mask.
 * @param x0 - First column.
 * @param x1 - Column after the last.
 * @param y0 - First row.
 * @param y1 - Row after the last.
 * @returns The median column height, or 0 for an empty range.
 */
function measureInkHeight(ink: Mask, x0: number, x1: number, y0: number, y1: number): number
{
    const heights = new Array<number>();
    const top = Math.max(0, y0);
    const bottom = Math.min(ink.height, y1);

    for (let x = Math.max(0, x0); x < Math.min(ink.width, x1); x++)
    {
        let count = 0;

        for (let y = top; y < bottom; y++)
        {
            count += ink.data[y * ink.width + x];
        }

        heights.push(count);
    }

    heights.sort(compareNumbers);

    return computeMedian(heights, 0);
}

/**
 * Blocks of line art: connected components of the line ink, the traced segments and the
 * skeleton of the traced tree after a dilation of one glyph height, keeping those at least a
 * fifth of the image in both directions that hold more segments or ink than the outline of a
 * box would.
 *
 * @param lineInk - Line ink mask.
 * @param document - Document, for its segments.
 * @param glyphHeight - Glyph height in pixels.
 * @param thickness - Line thickness in pixels.
 * @returns Panel boxes, largest first.
 */
function findPanels(lineInk: Mask, document: ExtractionDocument, glyphHeight: number, thickness: number): Array<Box>
{
    const radius = Math.max(2, Math.round(glyphHeight));
    const boxes = new Array<Box>();

    for (const segment of document.horizontals)
    {
        boxes.push(segment.box);
    }

    for (const segment of document.verticals)
    {
        boxes.push(segment.box);
    }

    // The traced tree is one block by construction, whatever gaps the drawing has, so its
    // skeleton (every vertical span and every parent-to-child connection) is added as ink.
    const half = Math.max(1, Math.round(thickness / 2));
    const nodeById = new Map<string, TreeNode>();

    for (const node of document.nodes)
    {
        nodeById.set(node.id, node);
        boxes.push({ x0: node.x - half, y0: node.y0, x1: node.x + half, y1: node.y1 });
    }

    for (const node of document.nodes)
    {
        const parent = node.parent === null ? undefined : nodeById.get(node.parent);

        if (parent !== undefined && node.attachY !== null)
        {
            boxes.push({ x0: Math.min(parent.x, node.x), y0: node.attachY - half, x1: Math.max(parent.x, node.x), y1: node.attachY + half });
        }
    }

    for (const tip of document.tips)
    {
        const parent = tip.parent === null ? undefined : nodeById.get(tip.parent);

        if (parent !== undefined)
        {
            boxes.push({ x0: Math.min(parent.x, tip.x), y0: tip.y - half, x1: Math.max(parent.x, tip.x), y1: tip.y + half });
        }
    }

    const combined = unionMask(lineInk, createMaskFromBoxes(boxes, lineInk.width, lineInk.height));
    const { components, labels } = findConnectedComponents(dilate(combined, radius));
    const inkPerComponent = new Array<number>(components.length).fill(0);

    for (let index = 0; index < labels.length; index++)
    {
        if (labels[index] > 0 && combined.data[index] === 1)
        {
            inkPerComponent[labels[index] - 1]++;
        }
    }

    const panels = new Array<Box>();

    for (let index = 0; index < components.length; index++)
    {
        const { box } = components[index];
        const width = box.x1 - box.x0;
        const height = box.y1 - box.y0;

        if (width < 0.2 * lineInk.width || height < 0.2 * lineInk.height)
        {
            continue;
        }

        let segmentsInside = 0;

        for (const other of boxes)
        {
            if (other.x0 >= box.x0 && other.x1 <= box.x1 && other.y0 >= box.y0 && other.y1 <= box.y1)
            {
                segmentsInside++;
            }
        }

        // A box outline is four segments with the ink of its perimeter; anything with more
        // segments, or clearly more ink than its perimeter, is a block worth reporting.
        const outlineInk = 2 * (width + height) * Math.max(1, thickness);

        if (segmentsInside >= 6 || inkPerComponent[index] >= 1.5 * outlineInk)
        {
            panels.push({
                x0: Math.max(0, box.x0 + radius),
                y0: Math.max(0, box.y0 + radius),
                x1: Math.min(lineInk.width, box.x1 - radius),
                y1: Math.min(lineInk.height, box.y1 - radius),
            });
        }
    }

    panels.sort(compareBoxAreasDescending);

    return panels;
}

/**
 * Orders boxes by area, largest first.
 *
 * @param left - First box.
 * @param right - Second box.
 * @returns Negative when left is larger.
 */
function compareBoxAreasDescending(left: Box, right: Box): number
{
    return (right.x1 - right.x0) * (right.y1 - right.y0) - (left.x1 - left.x0) * (left.y1 - left.y0);
}

/**
 * Describes a profile in a few lines for a report.
 *
 * @param profile - Profile to describe.
 * @returns One line per feature.
 */
export function formatProfile(profile: FigureProfile): Array<string>
{
    const lines = new Array<string>();
    const tips = profile.tipAlignment.aligned
        ? `aligned at x=${Math.round(profile.tipAlignment.x ?? 0)} (${Math.round(profile.tipAlignment.share * 100)}% of tips)`
        : `not aligned (${Math.round(profile.tipAlignment.share * 100)}% share one x)`;
    const lean = profile.font.slant === null ? "slant not measured (text too small or too little of it)" : `${profile.font.italic === true ? "italic" : "upright"} (slant ${profile.font.slant.toFixed(2)})`;
    const font = `stroke ${profile.font.strokeWidth} px, letter gap ${profile.font.letterGap.toFixed(2)} glyph heights${profile.font.letterSpaced ? " (letter-spaced)" : ""}, ${lean}`;
    const calibration = profile.timeScaled.calibration;
    const axis = profile.timeScaled.axis === null ? "none" : `${profile.timeScaled.ticks} ticks`;
    const scale = calibration === null ? "" : `, ${calibration.points} labels fit at ${Math.abs(calibration.pixelsPerUnit).toFixed(2)} px per unit (${calibration.pixelsPerUnit < 0 ? "older on the left" : "older on the right"}, residual ${calibration.residual.toFixed(1)} px)`;
    const time = `tinted ${Math.round(profile.timeScaled.tintedShare * 100)}%, band columns ${Math.round(profile.timeScaled.bandColumnShare * 100)}%${profile.timeScaled.bands ? " (bands)" : ""}, axis ${axis}${scale}, range bars ${profile.timeScaled.rangeBars}`;
    lines.push(`orientation: ${profile.orientation}`);
    lines.push(`lines: ${profile.lineThickness} px thick`);
    lines.push(`layout: ${profile.layout} (${profile.confidence.layout.toFixed(2)})`);
    lines.push(`tips: ${tips}`);
    lines.push(`support labels: ${profile.supportLabels} (${profile.confidence.supportLabels.toFixed(2)})`);
    lines.push(`clade marks: ${profile.cladeMarks.length === 0 ? "none" : profile.cladeMarks.join(", ")}`);
    lines.push(`font: ${font}`);
    lines.push(`text ink: ${profile.font.fragmented ? "fragmented" : "whole"}, ${profile.font.widened ? "widened by hysteresis" : "strict threshold"}; label crops condensed to ${profile.font.condensing.toFixed(2)}`);
    lines.push(`bridged gaps: ${profile.bridgedGaps}`);
    lines.push(`time scale: ${time}`);
    lines.push(`panels: ${profile.panels.length}`);

    if (profile.overridden.length > 0)
    {
        lines.push(`overridden: ${profile.overridden.join(", ")}`);
    }

    return lines;
}
