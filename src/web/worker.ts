/**
 * Extraction worker: runs the pipeline off the page's thread. OCR crops are sent back to the
 * page, which owns the Tesseract engine, and their text comes back as replies.
 */

import type { GrayImage, OcrEngine, OcrResult, ProgressReporter, RgbaImage } from "../core/types.ts";
import { extractTree } from "../core/pipeline.ts";
import type { OcrResponse, PageMessage, WorkerMessage } from "./messages.ts";

/**
 * The part of the worker's global scope this file uses.
 */
type WorkerPort = {
    /**
     * Sends a message to the page.
     *
     * @param message - Message to send.
     * @param transfer - Buffers to hand over rather than copy.
     */
    postMessage(message: WorkerMessage, transfer?: Array<Transferable>): void;

    /**
     * Listens for messages from the page.
     *
     * @param type - Always "message".
     * @param listener - Receives each message.
     */
    addEventListener(type: "message", listener: (event: MessageEvent<PageMessage>) => void): void;
};

/**
 * A pending OCR request awaiting the page's reply.
 */
type PendingOcr = {
    /**
     * Settles the request.
     *
     * @param result - Recognized text and confidence.
     */
    resolve(result: OcrResult): void;
};

const port = self as unknown as WorkerPort;
const pending = new Map<number, PendingOcr>();
let nextRequestId = 1;

/**
 * OCR engine that forwards each crop to the page and waits for its answer.
 */
class BridgedOcrEngine implements OcrEngine
{
    /**
     * Sends a crop to the page for reading.
     *
     * @param image - Gray crop.
     * @param kind - Whether a name or a number is expected.
     * @returns The page's answer.
     */
    public recognize(image: GrayImage, kind: "text" | "digits"): Promise<OcrResult>
    {
        const requestId = nextRequestId++;
        const buffer = new ArrayBuffer(image.data.byteLength);
        new Uint8Array(buffer).set(image.data);

        return new Promise(function register(resolve: (result: OcrResult) => void): void
        {
            pending.set(requestId, { resolve });
            port.postMessage({ type: "ocr", requestId, image: { width: image.width, height: image.height, buffer }, kind }, [buffer]);
        });
    }

    /**
     * Nothing to release; the page owns the engine.
     *
     * @returns Resolves at once.
     */
    public terminate(): Promise<void>
    {
        return Promise.resolve();
    }
}

/**
 * Reports pipeline progress to the page.
 */
class MessageProgressReporter implements ProgressReporter
{
    /**
     * Forwards a progress report.
     *
     * @param stage - Stage description.
     * @param done - Items done.
     * @param total - Items in total.
     */
    public report(stage: string, done: number, total: number): void
    {
        port.postMessage({ type: "progress", stage, done, total });
    }
}

/**
 * Runs the pipeline for one request and posts the outcome.
 *
 * @param request - Extraction request.
 * @returns Resolves when the outcome has been posted.
 */
async function runExtraction(request: Extract<PageMessage, { type: "extract" }>): Promise<void>
{
    const image: RgbaImage = { width: request.image.width, height: request.image.height, data: new Uint8ClampedArray(request.image.buffer) };

    try
    {
        const document = await extractTree(image, {
            ocr: request.readLabels ? new BridgedOcrEngine() : null,
            names: request.names,
            knownNames: request.knownNames,
            region: request.region,
            source: request.source,
            progress: new MessageProgressReporter(),
        });
        port.postMessage({ type: "done", document });
    }
    catch (error)
    {
        port.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
}

/**
 * Settles the OCR request a reply answers.
 *
 * @param response - Reply from the page.
 */
function receiveOcrResult(response: OcrResponse): void
{
    const waiting = pending.get(response.requestId);

    if (waiting !== undefined)
    {
        pending.delete(response.requestId);
        waiting.resolve({ text: response.text, confidence: response.confidence });
    }
}

/**
 * Dispatches a message from the page.
 *
 * @param event - Message event.
 */
function handleMessage(event: MessageEvent<PageMessage>): void
{
    if (event.data.type === "extract")
    {
        void runExtraction(event.data);
    }
    else
    {
        receiveOcrResult(event.data);
    }
}

port.addEventListener("message", handleMessage);
