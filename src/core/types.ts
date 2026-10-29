/**
 * Shared types for the extraction pipeline. The extraction document is the single
 * representation that the pipeline produces, the viewer edits and the exporters read.
 */

/**
 * An RGBA raster, as produced by a canvas or by an image decoder.
 */
export type RgbaImage = {
    /**
     * Width in pixels.
     */
    width: number;

    /**
     * Height in pixels.
     */
    height: number;

    /**
     * Interleaved RGBA bytes, row-major, four per pixel.
     */
    data: Uint8ClampedArray;
};

/**
 * A single-channel 8-bit raster.
 */
export type GrayImage = {
    /**
     * Width in pixels.
     */
    width: number;

    /**
     * Height in pixels.
     */
    height: number;

    /**
     * One byte per pixel, row-major; 0 is black.
     */
    data: Uint8ClampedArray;
};

/**
 * A binary raster, one byte per pixel, 1 where the mask is set.
 */
export type Mask = {
    /**
     * Width in pixels.
     */
    width: number;

    /**
     * Height in pixels.
     */
    height: number;

    /**
     * One byte per pixel, row-major; 1 where set.
     */
    data: Uint8Array;
};

/**
 * An axis-aligned pixel rectangle. The lower bounds are inclusive and the upper bounds
 * exclusive, so width is x1 - x0.
 */
export type Box = {
    /**
     * Left edge (inclusive).
     */
    x0: number;

    /**
     * Top edge (inclusive).
     */
    y0: number;

    /**
     * Right edge (exclusive).
     */
    x1: number;

    /**
     * Bottom edge (exclusive).
     */
    y1: number;
};

/**
 * A straight run of line art, either horizontal or vertical.
 */
export type Segment = {
    /**
     * Identifier, unique within the document.
     */
    id: string;

    /**
     * Whether the segment runs left-right or top-bottom.
     */
    orientation: "horizontal" | "vertical";

    /**
     * Bounding box of the ink.
     */
    box: Box;
};

/**
 * Who produced an element of the document.
 */
export type Provenance = "traced" | "manual";

/**
 * A detected row of text in the figure.
 */
export type TextLine = {
    /**
     * Identifier, unique within the document.
     */
    id: string;

    /**
     * Bounding box of the glyphs.
     */
    box: Box;

    /**
     * How many glyph components were clustered into this line. Touching letters make one
     * component per word, so a wide line with few components is still a label.
     */
    glyphCount: number;

    /**
     * What the line was used for.
     */
    role: "tip" | "node" | "unassigned";

    /**
     * Raw OCR output, if the line was read.
     */
    ocr: OcrResult | null;

    /**
     * The turned frame the box is measured in, when the row was found among labels set at a
     * slant; absent for a row in the figure's own frame.
     */
    frame?: RotatedFrame;
};

/**
 * The result of reading one crop with an OCR engine.
 */
export type OcrResult = {
    /**
     * Recognized text, trimmed.
     */
    text: string;

    /**
     * Engine confidence from 0 to 100, or -1 if unknown.
     */
    confidence: number;
};

/**
 * The outcome of matching an OCR string against a closed list of names.
 */
export type NameMatch = {
    /**
     * Best candidate from the list.
     */
    name: string;

    /**
     * Normalized similarity from 0 to 1.
     */
    similarity: number;

    /**
     * Gap between the best and the second-best similarity.
     */
    margin: number;

    /**
     * Whether the match is good enough to use without review.
     */
    accepted: boolean;

    /**
     * Which list the name came from: the paper's own list, or the known taxa of the data set.
     */
    source: "list" | "known";
};

/**
 * A terminal of the tree: the right end of a branch with no further node.
 */
export type Tip = {
    /**
     * Identifier, unique within the document.
     */
    id: string;

    /**
     * Pixel x of the branch end.
     */
    x: number;

    /**
     * Pixel y of the branch.
     */
    y: number;

    /**
     * Identifier of the parent node, or null if the tip is disconnected.
     */
    parent: string | null;

    /**
     * Identifier of the text line used as this tip's label, if any.
     */
    textLine: string | null;

    /**
     * Label as read from the figure, before name matching.
     */
    label: string | null;

    /**
     * Name match against the supplied list, if a list was supplied.
     */
    match: NameMatch | null;

    /**
     * Who produced this tip.
     */
    source: Provenance;

    /**
     * Age at the tip's branch end in the units of the time axis, or null without a calibration.
     */
    age: number | null;

    /**
     * Where the branch itself ended, when the tip was moved to the far side of a marker or a
     * solid shape the branch ran into; absent otherwise.
     */
    extendedFrom?: number;
};

/**
 * An internal node of the tree: a vertical segment joining two or more branches.
 */
export type TreeNode = {
    /**
     * Identifier, unique within the document.
     */
    id: string;

    /**
     * Pixel x of the vertical.
     */
    x: number;

    /**
     * Top of the vertical.
     */
    y0: number;

    /**
     * Bottom of the vertical.
     */
    y1: number;

    /**
     * Pixel y where the parent branch meets this vertical, or null at the root.
     */
    attachY: number | null;

    /**
     * Identifier of the parent node, or null at the root.
     */
    parent: string | null;

    /**
     * Identifiers of child nodes and tips, ordered top to bottom.
     */
    children: Array<string>;

    /**
     * Identifier of the text line used as this node's label, if any.
     */
    textLine: string | null;

    /**
     * Node label as read from the figure, typically a support value.
     */
    label: string | null;

    /**
     * Who produced this node.
     */
    source: Provenance;

    /**
     * Age of the junction in the units of the time axis, or null without a calibration.
     */
    age: number | null;
};

/**
 * A quality-control finding about the extraction.
 */
export type QcIssue = {
    /**
     * Whether the issue blocks automatic acceptance.
     */
    severity: "error" | "warning" | "info";

    /**
     * Stable machine-readable code.
     */
    code: string;

    /**
     * Human-readable description.
     */
    message: string;

    /**
     * Identifier of the element concerned, if any.
     */
    subject: string | null;
};

/**
 * Source image dimensions and, when known, its origin.
 */
export type ImageInfo = {
    /**
     * Width in pixels.
     */
    width: number;

    /**
     * Height in pixels.
     */
    height: number;

    /**
     * Path or URL of the source image, if known.
     */
    source: string | null;

    /**
     * The part of the image that was analyzed, or null for all of it. Coordinates in the
     * document are always those of the full image.
     */
    region: Box | null;

    /**
     * Clockwise quarter turns applied to the source image before analysis. Every coordinate
     * in the document, and the width and height here, refer to the turned image.
     */
    quarterTurns: number;
};

/**
 * A vertical that was considered as a node and rejected, kept for diagnostics and review.
 */
export type RejectedVertical = {
    /**
     * Segment identifier.
     */
    id: string;

    /**
     * Why it was rejected.
     */
    reason: "no-children";

    /**
     * Pruning iteration in which it was rejected.
     */
    iteration: number;

    /**
     * Branch identifiers attached as children at the time.
     */
    children: Array<string>;

    /**
     * Branch identifiers attached as parents at the time.
     */
    parents: Array<string>;
};

/**
 * A branch piece after attachment, for diagnostics and review.
 */
export type BranchRecord = {
    /**
     * Piece identifier (segment id, with a suffix when split at crossings).
     */
    id: string;

    /**
     * Left end x.
     */
    x0: number;

    /**
     * Right end x.
     */
    x1: number;

    /**
     * Height.
     */
    y: number;

    /**
     * Segment id of the vertical its left end attached to, or null.
     */
    left: string | null;

    /**
     * Segment id of the vertical its right end attached to, or null.
     */
    right: string | null;
};

/**
 * Everything the pipeline found in one figure.
 */
export type ExtractionDocument = {
    /**
     * Document schema version.
     */
    version: 1;

    /**
     * Source image dimensions and, when known, its origin.
     */
    image: ImageInfo;

    /**
     * Horizontal line-art segments (branches).
     */
    horizontals: Array<Segment>;

    /**
     * Vertical line-art segments (node connectors).
     */
    verticals: Array<Segment>;

    /**
     * Detected text lines.
     */
    textLines: Array<TextLine>;

    /**
     * Internal nodes.
     */
    nodes: Array<TreeNode>;

    /**
     * Terminals.
     */
    tips: Array<Tip>;

    /**
     * Identifier of the root node, or null if no tree was found.
     */
    root: string | null;

    /**
     * Quality-control findings.
     */
    qc: Array<QcIssue>;

    /**
     * Verticals that were considered as nodes and rejected, with the reason, for review.
     */
    rejectedVerticals: Array<RejectedVertical>;

    /**
     * Branch pieces with the vertical segment each end attached to, for review.
     */
    branches: Array<BranchRecord>;

    /**
     * Median glyph height in pixels, used to scale label heuristics.
     */
    glyphHeight: number;

    /**
     * Figure-level properties measured once per extraction.
     */
    profile: FigureProfile;

    /**
     * Milliseconds spent in each stage.
     */
    timings: Record<string, number>;
};

/**
 * An OCR engine the pipeline can call. The crop is already upscaled and has line art erased.
 */
export type OcrEngine = {
    /**
     * Reads a single line of text from the crop.
     *
     * @param image - The crop to read.
     * @param kind - Whether a taxon name or a numeric support value is expected.
     * @returns The recognized text and confidence.
     */
    recognize(image: GrayImage, kind: "text" | "digits"): Promise<OcrResult>;

    /**
     * Releases engine resources.
     *
     * @returns Resolves when the engine has shut down.
     */
    terminate(): Promise<void>;
};

/**
 * Receives progress while the pipeline runs.
 */
export type ProgressReporter = {
    /**
     * Reports that a stage is under way.
     *
     * @param stage - Short description of the stage.
     * @param done - Items finished so far, or 0 when the stage is not itemized.
     * @param total - Items in the stage, or 0 when the stage is not itemized.
     */
    report(stage: string, done: number, total: number): void;
};

/**
 * A point in pixels.
 */
export type Point = {
    /**
     * Horizontal coordinate.
     */
    x: number;

    /**
     * Vertical coordinate.
     */
    y: number;
};

/**
 * A frame turned against the figure so that slanted labels read level. A figure point maps
 * into it by turning about the source center by minus the angle and landing about the frame
 * center; the frame is a canvas of its own width and height.
 */
export type RotatedFrame = {
    /**
     * Slant of the labels in radians, positive when they run downward to the right.
     */
    angle: number;

    /**
     * Center of the turn in the figure.
     */
    sourceCenterX: number;

    /**
     * Center of the turn in the figure.
     */
    sourceCenterY: number;

    /**
     * Where the source center lands in the frame.
     */
    centerX: number;

    /**
     * Where the source center lands in the frame.
     */
    centerY: number;

    /**
     * Frame canvas width.
     */
    width: number;

    /**
     * Frame canvas height.
     */
    height: number;
};

/**
 * Which way a tree figure stands: root on the left with tips on the right (what the pipeline
 * traces), root at the bottom or top with the tree on its side, or undecided.
 */
export type Orientation = "root-left" | "root-bottom" | "root-top" | "unknown";

/**
 * How a figure connects a node's vertical to its parent branch.
 */
export type LayoutKind = "centered" | "staircase" | "slanted" | "unknown";

/**
 * Where a figure prints support values.
 */
export type SupportLabelStyle = "none" | "above-branch" | "boxed-on-branch" | "at-node" | "unknown";

/**
 * Marks that name clades rather than taxa.
 */
export type CladeMark = "letters" | "discs";

/**
 * Whether the tips end on one vertical line.
 */
export type TipAlignment = {
    /**
     * True when most tips end at the same x.
     */
    aligned: boolean;

    /**
     * That x, when aligned.
     */
    x: number | null;

    /**
     * Share of tips ending within half a glyph height of the commonest x.
     */
    share: number;
};

/**
 * Properties of the label font.
 */
export type FontProfile = {
    /**
     * Typical stroke width in pixels.
     */
    strokeWidth: number;

    /**
     * Typical blank gap between letters, as a fraction of the glyph height.
     */
    letterGap: number;

    /**
     * Slant of the text as horizontal shift per unit height, positive for a rightward lean, or
     * null when the text is too small or too sparse to measure it.
     */
    slant: number | null;

    /**
     * True when the slant says italic, false when it says upright, null when unmeasured.
     */
    italic: boolean | null;

    /**
     * True when letters sit far apart, as in a letter-spaced font.
     */
    letterSpaced: boolean;

    /**
     * True when the strict text threshold broke letters into fragments.
     */
    fragmented: boolean;

    /**
     * True when the text ink was widened by hysteresis into fainter pixels.
     */
    widened: boolean;

    /**
     * Horizontal factor applied to label crops before OCR, from 0.55 to 1.
     */
    condensing: number;
};

/**
 * Signs of a time-scaled figure.
 */
export type TimeScaleProfile = {
    /**
     * Share of the image that is neither white nor ink: bands, boxes, shading.
     */
    tintedShare: number;

    /**
     * Share of columns that are tinted over most of their height, which bands are and a clade
     * box behind one subtree is not.
     */
    bandColumnShare: number;

    /**
     * True when enough columns are tinted top to bottom for background bands.
     */
    bands: boolean;

    /**
     * The axis line between its outermost tick marks, or null when no axis was found.
     */
    axis: Box | null;

    /**
     * Tick marks found along the axis.
     */
    ticks: number;

    /**
     * The line from a column to a value along the axis, once the labels have been read and
     * fit, or null.
     */
    calibration: AxisCalibration | null;

    /**
     * Horizontals much thicker than the lines that end at a tip.
     */
    rangeBars: number;
};

/**
 * The line that turns a pixel column into a value along a time axis.
 */
export type AxisCalibration = {
    /**
     * Column at value zero.
     */
    originX: number;

    /**
     * Columns per unit of value; negative when values grow to the left.
     */
    pixelsPerUnit: number;

    /**
     * Labels the fit used.
     */
    points: number;

    /**
     * Root-mean-square distance of the labels from the line, in pixels.
     */
    residual: number;
};

/**
 * How sure each voted feature is, from 0 (a toss-up) to 1.
 */
export type ProfileConfidence = {
    /**
     * Layout vote margin.
     */
    layout: number;

    /**
     * Tip alignment margin.
     */
    tipAlignment: number;

    /**
     * Support label style margin.
     */
    supportLabels: number;
};

/**
 * Figure-level properties, measured once and recorded so later steps and the viewer can see
 * what kind of figure this is. Values marked unknown leave every step at its default behavior.
 */
export type FigureProfile = {
    /**
     * Which way the figure stood before it was turned for analysis.
     */
    orientation: Orientation;

    /**
     * Line thickness in pixels, as measured on the line ink.
     */
    lineThickness: number;

    /**
     * Layout family.
     */
    layout: LayoutKind;

    /**
     * Tip alignment.
     */
    tipAlignment: TipAlignment;

    /**
     * Support label style.
     */
    supportLabels: SupportLabelStyle;

    /**
     * Clade marks present.
     */
    cladeMarks: Array<CladeMark>;

    /**
     * Label font.
     */
    font: FontProfile;

    /**
     * Time-scale signs.
     */
    timeScaled: TimeScaleProfile;

    /**
     * Boxes of separate blocks of line art, largest first; a figure with two trees has two.
     */
    panels: Array<Box>;

    /**
     * Collinear segment pairs that were joined across a gap with ink in it.
     */
    bridgedGaps: number;

    /**
     * Vote margins.
     */
    confidence: ProfileConfidence;

    /**
     * Features whose values were set by the caller rather than measured.
     */
    overridden: Array<string>;
};

/**
 * Profile values a caller fixes in advance; each replaces the measured value.
 */
export type ProfileOverrides = {
    /**
     * Layout family.
     */
    layout?: LayoutKind;

    /**
     * Support label style.
     */
    supportLabels?: SupportLabelStyle;

    /**
     * Whether tips are aligned.
     */
    tipsAligned?: boolean;

    /**
     * Whether the font is italic.
     */
    italic?: boolean;

    /**
     * Whether to widen the text ink by hysteresis, instead of deciding from fragmentation and
     * glyph size.
     */
    widenText?: boolean;

    /**
     * Horizontal factor for label crops before OCR, instead of deciding from the letter gap.
     */
    condensing?: number;
};
