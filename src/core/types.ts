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
     * How many glyph components were clustered into this line.
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
