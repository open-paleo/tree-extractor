/**
 * Messages between the page and the extraction worker.
 */

import type { Box, ExtractionDocument } from "../core/types.ts";

/**
 * Pixels sent across the thread boundary; the buffer is transferred, not copied.
 */
export type TransferableImage = {
    /**
     * Width in pixels.
     */
    width: number;

    /**
     * Height in pixels.
     */
    height: number;

    /**
     * RGBA bytes for the image, or gray bytes for an OCR crop.
     */
    buffer: ArrayBuffer;
};

/**
 * Page to worker: run the pipeline.
 */
export type ExtractRequest = {
    /**
     * Message kind.
     */
    type: "extract";

    /**
     * Image to analyze.
     */
    image: TransferableImage;

    /**
     * Closed list of names, possibly empty.
     */
    names: Array<string>;

    /**
     * Known taxa to fall back on, possibly empty.
     */
    knownNames: Array<string>;

    /**
     * Region to analyze, or null.
     */
    region: Box | null;

    /**
     * Whether labels should be read; OCR requests come back to the page.
     */
    readLabels: boolean;

    /**
     * Where the image came from.
     */
    source: string;
};

/**
 * Page to worker: the answer to an OCR request.
 */
export type OcrResponse = {
    /**
     * Message kind.
     */
    type: "ocr-result";

    /**
     * Identifier of the request answered.
     */
    requestId: number;

    /**
     * Recognized text.
     */
    text: string;

    /**
     * Engine confidence.
     */
    confidence: number;
};

/**
 * Anything the page sends to the worker.
 */
export type PageMessage = ExtractRequest | OcrResponse;

/**
 * Worker to page: read this crop.
 */
export type OcrRequest = {
    /**
     * Message kind.
     */
    type: "ocr";

    /**
     * Identifier to answer with.
     */
    requestId: number;

    /**
     * Gray crop to read.
     */
    image: TransferableImage;

    /**
     * Whether a name or a number is expected.
     */
    kind: "text" | "digits";
};

/**
 * Worker to page: a stage is under way.
 */
export type ProgressMessage = {
    /**
     * Message kind.
     */
    type: "progress";

    /**
     * Stage description.
     */
    stage: string;

    /**
     * Items done, or 0.
     */
    done: number;

    /**
     * Items in total, or 0.
     */
    total: number;
};

/**
 * Worker to page: the pipeline finished.
 */
export type DoneMessage = {
    /**
     * Message kind.
     */
    type: "done";

    /**
     * The extraction document.
     */
    document: ExtractionDocument;
};

/**
 * Worker to page: the pipeline failed.
 */
export type ErrorMessage = {
    /**
     * Message kind.
     */
    type: "error";

    /**
     * What went wrong.
     */
    message: string;
};

/**
 * Anything the worker sends to the page.
 */
export type WorkerMessage = OcrRequest | ProgressMessage | DoneMessage | ErrorMessage;
