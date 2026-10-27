/**
 * Adapter from Tesseract.js to the pipeline's OCR interface. The Tesseract module is passed in
 * so the same adapter serves Node (imported package) and the browser (script-tag global).
 */

import type { GrayImage, OcrEngine, OcrResult } from "../core/types.ts";
import { encodeGrayBmp } from "./bmp.ts";

/**
 * The text Tesseract.js read from an image.
 */
export type TesseractRecognitionData = {
    /**
     * Recognized text.
     */
    text: string;

    /**
     * Engine confidence from 0 to 100.
     */
    confidence: number;
};

/**
 * The result object Tesseract.js returns from recognize.
 */
export type TesseractRecognition = {
    /**
     * The recognized text and confidence.
     */
    data: TesseractRecognitionData;
};

/**
 * The part of a Tesseract.js worker the adapter uses.
 */
export type TesseractWorkerLike = {
    /**
     * Sets engine parameters.
     */
    setParameters(parameters: Record<string, string>): Promise<unknown>;

    /**
     * Recognizes an image.
     */
    recognize(image: Buffer | Blob): Promise<TesseractRecognition>;

    /**
     * Shuts the worker down.
     */
    terminate(): Promise<unknown>;
};

/**
 * The part of the Tesseract.js module the adapter uses.
 */
export type TesseractLike = {
    /**
     * Creates a worker for a language.
     */
    createWorker(language: string): Promise<TesseractWorkerLike>;
};

/**
 * Wraps BMP bytes in whatever image container the host's Tesseract accepts.
 *
 * @param bytes - BMP file contents.
 * @returns A Buffer in Node, a Blob in the browser.
 */
function wrapImageInput(bytes: Uint8Array): Buffer | Blob
{
    if (typeof Buffer !== "undefined")
    {
        return Buffer.from(bytes);
    }

    return new Blob([bytes], { type: "image/bmp" });
}

/**
 * Creates an OCR engine backed by Tesseract.js in single-line mode.
 *
 * @param tesseract - The Tesseract.js module or global.
 * @param language - Tesseract language code.
 * @returns An engine ready to read crops.
 */
export async function createTesseractOcr(tesseract: TesseractLike, language = "eng"): Promise<OcrEngine>
{
    const worker = await tesseract.createWorker(language);
    await worker.setParameters({ tessedit_pageseg_mode: "7", preserve_interword_spaces: "1" });

    return new TesseractOcrEngine(worker);
}

/**
 * OCR engine backed by one Tesseract.js worker in single-line mode.
 */
class TesseractOcrEngine implements OcrEngine
{
    private readonly worker: TesseractWorkerLike;

    /**
     * Wraps a configured worker.
     *
     * @param worker - Worker already set to single-line mode.
     */
    public constructor(worker: TesseractWorkerLike)
    {
        this.worker = worker;
    }

    /**
     * Reads a single line of text from the crop.
     *
     * @param image - The crop to read.
     * @param _ - Whether a name or a number is expected; Tesseract is run the same way for both.
     * @returns The recognized text and confidence.
     */
    public async recognize(image: GrayImage, _: "text" | "digits"): Promise<OcrResult>
    {
        const result = await this.worker.recognize(wrapImageInput(encodeGrayBmp(image)));

        return { text: result.data.text.trim(), confidence: result.data.confidence };
    }

    /**
     * Shuts the worker down.
     *
     * @returns Resolves when it has stopped.
     */
    public async terminate(): Promise<void>
    {
        await this.worker.terminate();
    }
}
