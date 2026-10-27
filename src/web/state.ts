/**
 * The viewer's shared state and the types that describe it.
 */

import type { Box, ExtractionDocument, RgbaImage } from "../core/types.ts";

/**
 * Which overlays are drawn.
 */
export type Layers = {
    /**
     * Horizontal and vertical segments.
     */
    segments: boolean;

    /**
     * Text line boxes.
     */
    text: boolean;

    /**
     * Node markers and labels.
     */
    nodes: boolean;

    /**
     * Tip markers and identifiers.
     */
    tips: boolean;
};

/**
 * Mapping from image pixels to screen pixels: screen = image * scale + offset.
 */
export type ViewTransform = {
    /**
     * Screen pixels per image pixel.
     */
    scale: number;

    /**
     * Horizontal offset in screen pixels.
     */
    offsetX: number;

    /**
     * Vertical offset in screen pixels.
     */
    offsetY: number;
};

/**
 * The selected tip or node.
 */
export type Selection = {
    /**
     * Which list it belongs to.
     */
    kind: "tip" | "node";

    /**
     * Its identifier in the document.
     */
    id: string;
};

/**
 * A pointer drag in progress.
 */
export type DragState = {
    /**
     * Pointer being tracked.
     */
    pointerId: number;

    /**
     * Screen x where the drag started.
     */
    startX: number;

    /**
     * Screen y where the drag started.
     */
    startY: number;

    /**
     * View offset when the drag started.
     */
    startOffsetX: number;

    /**
     * View offset when the drag started.
     */
    startOffsetY: number;

    /**
     * Whether the pointer moved far enough to count as a drag rather than a click.
     */
    moved: boolean;
};

/**
 * What a click or drag on the canvas does.
 */
export type Mode = "pan" | "region" | "add-tip" | "add-node";

/**
 * Everything the viewer knows about the current figure.
 */
export type ViewerState = {
    /**
     * Decoded pixels of the loaded image, or null before one is loaded.
     */
    image: RgbaImage | null;

    /**
     * Drawable form of the loaded image.
     */
    bitmap: ImageBitmap | null;

    /**
     * Result of the last extraction.
     */
    extraction: ExtractionDocument | null;

    /**
     * Region of the image to analyze, or null for all of it.
     */
    region: Box | null;

    /**
     * Region being dragged out, or null.
     */
    draftRegion: Box | null;

    /**
     * Vertical span of a node being dragged out, or null. Only x0, y0 and y1 are used.
     */
    draftSpan: Box | null;

    /**
     * Selected tip or node.
     */
    selection: Selection | null;

    /**
     * Overlay visibility.
     */
    layers: Layers;

    /**
     * What a drag does.
     */
    mode: Mode;

    /**
     * Name of the loaded file without extension, for downloads.
     */
    fileStem: string;
};

/**
 * Makes the initial, empty viewer state.
 *
 * @returns Fresh state.
 */
export function createViewerState(): ViewerState
{
    return {
        image: null,
        bitmap: null,
        extraction: null,
        region: null,
        draftRegion: null,
        draftSpan: null,
        selection: null,
        layers: { segments: true, text: true, nodes: true, tips: true },
        mode: "pan",
        fileStem: "tree",
    };
}
