/**
 * The standalone page: mounts the viewer on the page's own element, with the worker built
 * beside it, Tesseract.js, its core and its language data served from node_modules by the
 * development server, and the known taxa shipped with the tool. Nothing comes from a CDN.
 * An ?image= query parameter names an image to load at once, a convenience for development.
 */

import type { TesseractLike } from "../ocr/tesseract.ts";
import { mountTreeExtractor } from "./viewer.ts";

/**
 * Hands the viewer the Tesseract.js module the page's script tag loaded.
 *
 * @returns The module.
 */
function loadTesseract(): TesseractLike
{
    if (window.Tesseract === undefined)
    {
        throw new Error("Tesseract.js did not load; check your network connection.");
    }

    return window.Tesseract;
}

const container = document.querySelector<HTMLElement>("#app");

if (container === null)
{
    throw new Error("missing element #app");
}

mountTreeExtractor(container, {
    workerUrl: new URL("./worker.js", import.meta.url).href,
    loadTesseract,
    tesseractPaths: {
        workerPath: new URL("/node_modules/tesseract.js/dist/worker.min.js", location.href).href,
        corePath: new URL("/node_modules/tesseract.js-core/", location.href).href,
        langPath: new URL("/node_modules/@tesseract.js-data/eng/4.0.0_best_int", location.href).href,
    },
    knownNames: new URL("../../names/known-taxa.txt", import.meta.url).href,
    image: new URLSearchParams(location.search).get("image") ?? undefined,
});
