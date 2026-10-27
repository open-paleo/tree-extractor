/**
 * Page-side handle on the extraction worker: sends images, answers its OCR requests with the
 * page's Tesseract engine, and relays progress.
 */

import type { Box, ExtractionDocument, OcrEngine, RgbaImage } from "../core/types.ts";
import type { PageMessage, WorkerMessage } from "./messages.ts";

/**
 * What the page wants to hear about during a run.
 */
export type ExtractionListener = {
    /**
     * Called as stages start and labels are read.
     *
     * @param stage - Stage description.
     * @param done - Items done, or 0.
     * @param total - Items in total, or 0.
     */
    onProgress(stage: string, done: number, total: number): void;
};

/**
 * Inputs to one run.
 */
export type ExtractionRequest = {
    /**
     * Image to analyze.
     */
    image: RgbaImage;

    /**
     * Closed list of names, possibly empty.
     */
    names: Array<string>;

    /**
     * Region to analyze, or null.
     */
    region: Box | null;

    /**
     * OCR engine for labels, or null to skip them.
     */
    ocr: OcrEngine | null;

    /**
     * Where the image came from.
     */
    source: string;
};

/**
 * Settlement functions for the run in flight.
 */
type PendingRun = {
    /**
     * Delivers the document.
     *
     * @param document - Result.
     */
    resolve(document: ExtractionDocument): void;

    /**
     * Fails the run.
     *
     * @param error - Reason.
     */
    reject(error: Error): void;

    /**
     * OCR engine to answer crop requests with.
     */
    ocr: OcrEngine | null;

    /**
     * Progress listener.
     */
    listener: ExtractionListener;
};

/**
 * Owns the worker and runs one extraction at a time.
 */
export class ExtractionClient
{
    private readonly worker: Worker;

    private pendingRun: PendingRun | null = null;

    /**
     * Starts the worker.
     *
     * @param scriptUrl - URL of the compiled worker module.
     */
    public constructor(scriptUrl: string)
    {
        this.worker = new Worker(scriptUrl, { type: "module" });
        this.worker.addEventListener("message", this.handleMessage.bind(this));
        this.worker.addEventListener("error", this.handleError.bind(this));
    }

    /**
     * Runs the pipeline in the worker.
     *
     * @param request - Inputs.
     * @param listener - Progress listener.
     * @returns The extraction document.
     */
    public extract(request: ExtractionRequest, listener: ExtractionListener): Promise<ExtractionDocument>
    {
        if (this.pendingRun !== null)
        {
            return Promise.reject(new Error("an extraction is already running"));
        }

        const buffer = new ArrayBuffer(request.image.data.byteLength);
        new Uint8Array(buffer).set(request.image.data);
        const message: PageMessage = {
            type: "extract",
            image: { width: request.image.width, height: request.image.height, buffer },
            names: request.names,
            region: request.region,
            readLabels: request.ocr !== null,
            source: request.source,
        };
        const { promise, resolve, reject } = Promise.withResolvers<ExtractionDocument>();
        this.pendingRun = { resolve, reject, ocr: request.ocr, listener };
        this.worker.postMessage(message, [buffer]);

        return promise;
    }

    /**
     * Answers an OCR request from the worker with the page's engine.
     *
     * @param requestId - Request to answer.
     * @param width - Crop width.
     * @param height - Crop height.
     * @param buffer - Gray pixels.
     * @param kind - Whether a name or a number is expected.
     * @returns Resolves when the answer has been posted.
     */
    private async answerOcr(requestId: number, width: number, height: number, buffer: ArrayBuffer, kind: "text" | "digits"): Promise<void>
    {
        const run = this.pendingRun;
        let text = "";
        let confidence = -1;

        if (run !== null && run.ocr !== null)
        {
            const result = await run.ocr.recognize({ width, height, data: new Uint8ClampedArray(buffer) }, kind);
            text = result.text;
            confidence = result.confidence;
        }

        const reply: PageMessage = { type: "ocr-result", requestId, text, confidence };
        this.worker.postMessage(reply);
    }

    /**
     * Dispatches a message from the worker.
     *
     * @param event - Message event.
     */
    private handleMessage(event: MessageEvent<WorkerMessage>): void
    {
        const data = event.data;

        if (data.type === "ocr")
        {
            void this.answerOcr(data.requestId, data.image.width, data.image.height, data.image.buffer, data.kind);
        }
        else if (data.type === "progress")
        {
            this.pendingRun?.listener.onProgress(data.stage, data.done, data.total);
        }
        else if (data.type === "done")
        {
            const run = this.pendingRun;
            this.pendingRun = null;
            run?.resolve(data.document);
        }
        else
        {
            const run = this.pendingRun;
            this.pendingRun = null;
            run?.reject(new Error(data.message));
        }
    }

    /**
     * Fails the run in flight when the worker itself breaks.
     *
     * @param event - Error event.
     */
    private handleError(event: ErrorEvent): void
    {
        const run = this.pendingRun;
        this.pendingRun = null;
        run?.reject(new Error(event.message || "the extraction worker failed"));
    }
}
