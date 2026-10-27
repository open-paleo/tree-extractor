/**
 * Browser viewer entry point: wires the page's elements to the viewer state, the canvas, the
 * results panel and the extraction pipeline.
 */

import type { OcrEngine } from "../core/types.ts";
import { extractTree, formatTimings } from "../core/pipeline.ts";
import { createTesseractOcr } from "../ocr/tesseract.ts";
import type { Box } from "../core/types.ts";
import type { Layers, Selection } from "./state.ts";
import { createViewerState } from "./state.ts";
import { CanvasView } from "./canvas.ts";
import { findNode, findTip, getNodeMarkerY } from "./lookup.ts";
import type { ResultElements } from "./results.ts";
import { getSelectionFromEvent, highlightSelection, renderResults, updateNewick } from "./results.ts";
import { downloadDocumentFile, downloadNewickFile, downloadNexusFile } from "./exports.ts";
import { PointerController } from "./interaction.ts";

/**
 * Finds a required element in the page.
 *
 * @param selector - CSS selector.
 * @returns The element.
 */
function getElement<T extends Element>(selector: string): T
{
    const element = document.querySelector<T>(selector);

    if (element === null)
    {
        throw new Error(`missing element ${selector}`);
    }

    return element;
}

const fileInput = getElement<HTMLInputElement>("#file");
const ocrCheckbox = getElement<HTMLInputElement>("#ocr");
const namesInput = getElement<HTMLTextAreaElement>("#names");
const runButton = getElement<HTMLButtonElement>("#run");
const statusLine = getElement<HTMLParagraphElement>("#status");
const canvasWrap = getElement<HTMLDivElement>("#canvas-wrap");
const canvas = getElement<HTMLCanvasElement>("#canvas");
const fitButton = getElement<HTMLButtonElement>("#fit");
const actualButton = getElement<HTMLButtonElement>("#actual");
const zoomInButton = getElement<HTMLButtonElement>("#zoom-in");
const zoomOutButton = getElement<HTMLButtonElement>("#zoom-out");
const zoomLevel = getElement<HTMLSpanElement>("#zoom-level");
const regionModeButton = getElement<HTMLButtonElement>("#region-mode");
const clearRegionButton = getElement<HTMLButtonElement>("#clear-region");
const downloadNewick = getElement<HTMLButtonElement>("#download-newick");
const downloadNexus = getElement<HTMLButtonElement>("#download-nexus");
const downloadJson = getElement<HTMLButtonElement>("#download-json");
const results: ResultElements = {
    tipsList: getElement<HTMLOListElement>("#tips"),
    nodesList: getElement<HTMLOListElement>("#nodes"),
    qcList: getElement<HTMLUListElement>("#qc"),
    newickOutput: getElement<HTMLTextAreaElement>("#newick"),
    downloadButtons: [downloadNewick, downloadNexus, downloadJson],
};

const state = createViewerState();
const canvasView = new CanvasView(canvas);
let ocrEngine: OcrEngine | null = null;

/**
 * Shows a status message.
 *
 * @param message - Text to show.
 */
function setStatus(message: string): void
{
    statusLine.textContent = message;
}

/**
 * Updates the zoom readout and tool button states.
 */
function updateToolbar(): void
{
    const loaded = state.bitmap !== null;
    zoomLevel.textContent = loaded ? `${Math.round(canvasView.view.scale * 100)}%` : "";
    fitButton.disabled = !loaded;
    actualButton.disabled = !loaded;
    zoomInButton.disabled = !loaded;
    zoomOutButton.disabled = !loaded;
    regionModeButton.disabled = !loaded;
    clearRegionButton.disabled = state.region === null;
    regionModeButton.classList.toggle("active", state.mode === "region");
    canvas.classList.toggle("region", state.mode === "region");
}

/**
 * Redraws the canvas and refreshes the toolbar.
 */
function redraw(): void
{
    canvasView.render(state);
    updateToolbar();
}

/**
 * Changes the selection, highlighting it in the lists and on the canvas.
 *
 * @param next - New selection, or null to clear.
 * @param reveal - Whether to pan the canvas so the selection is visible.
 */
function select(next: Selection | null, reveal: boolean): void
{
    state.selection = next;
    highlightSelection(results, next);

    if (next !== null && reveal && state.extraction !== null)
    {
        if (next.kind === "tip")
        {
            const tip = findTip(state.extraction, next.id);

            if (tip !== null)
            {
                canvasView.ensureVisible(state, tip.x, tip.y);
            }
        }
        else
        {
            const node = findNode(state.extraction, next.id);

            if (node !== null)
            {
                canvasView.ensureVisible(state, node.x, getNodeMarkerY(node));
            }
        }
    }

    redraw();
}

/**
 * Decodes a file into an RGBA image and shows it.
 *
 * @param file - Image file.
 * @returns Resolves when the image is on screen.
 */
async function loadFile(file: File): Promise<void>
{
    const bitmap = await createImageBitmap(file);
    const scratch = document.createElement("canvas");
    scratch.width = bitmap.width;
    scratch.height = bitmap.height;
    const context = scratch.getContext("2d");

    if (context === null)
    {
        throw new Error("could not get a drawing context");
    }

    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height);
    state.bitmap = bitmap;
    state.image = { width: data.width, height: data.height, data: data.data };
    state.extraction = null;
    state.region = null;
    state.draftRegion = null;
    state.selection = null;
    state.mode = "pan";
    state.fileStem = file.name.replace(/\.[^.]+$/, "");
    runButton.disabled = false;
    setStatus(`${file.name}: ${bitmap.width} × ${bitmap.height} px. Ready.`);
    canvasView.resize(state);
    canvasView.fit(state);
    renderResults(results, null);
    updateToolbar();
}

/**
 * Reads the optional name list from the page.
 *
 * @returns Names, one per non-blank line.
 */
function readNames(): Array<string>
{
    const names = new Array<string>();

    for (const line of namesInput.value.split(/\r?\n/))
    {
        if (line.trim().length > 0)
        {
            names.push(line.trim());
        }
    }

    return names;
}

/**
 * Runs the pipeline on the loaded image, or on the marked region of it.
 *
 * @returns Resolves when results are shown.
 */
async function runExtraction(): Promise<void>
{
    if (state.image === null)
    {
        return;
    }

    runButton.disabled = true;

    try
    {
        if (ocrCheckbox.checked && ocrEngine === null)
        {
            const tesseract = window.Tesseract;

            if (tesseract === undefined)
            {
                throw new Error("Tesseract.js did not load; check your network connection.");
            }

            setStatus("Starting the OCR engine (first run downloads language data)…");
            ocrEngine = await createTesseractOcr(tesseract);
        }

        setStatus(state.region === null ? "Tracing…" : "Tracing the selected region…");
        state.extraction = await extractTree(state.image, {
            ocr: ocrCheckbox.checked ? ocrEngine : null,
            names: readNames(),
            source: state.fileStem,
            region: state.region,
        });
        state.selection = null;
        setStatus(`${state.extraction.tips.length} tips, ${state.extraction.nodes.length} nodes. ${formatTimings(state.extraction.timings)}.`);
    }
    catch (error)
    {
        setStatus(`Failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    runButton.disabled = false;
    renderResults(results, state.extraction);
    select(null, false);
}

/**
 * Loads the file picked in the file input.
 */
function handleFileChange(): void
{
    const file = fileInput.files?.[0];

    if (file !== undefined)
    {
        void loadFile(file);
    }
}

/**
 * Loads a file dropped anywhere on the page.
 *
 * @param event - Drop event.
 */
function handleDrop(event: DragEvent): void
{
    event.preventDefault();
    const file = event.dataTransfer?.files[0];

    if (file !== undefined)
    {
        void loadFile(file);
    }
}

/**
 * Keeps the browser from opening a dragged file.
 *
 * @param event - Drag event.
 */
function handleDragOver(event: DragEvent): void
{
    event.preventDefault();
}

/**
 * Starts extraction.
 */
function handleRunClick(): void
{
    void runExtraction();
}

/**
 * Toggles an overlay layer from its checkbox.
 *
 * @param event - Change event from a layer checkbox.
 */
function handleLayerChange(event: Event): void
{
    const checkbox = event.currentTarget as HTMLInputElement;
    state.layers[checkbox.dataset.layer as keyof Layers] = checkbox.checked;
    redraw();
}

/**
 * Fits the image in the view.
 */
function handleFitClick(): void
{
    canvasView.fit(state);
    updateToolbar();
}

/**
 * Shows the image at one image pixel per screen pixel, keeping the center fixed.
 */
function handleActualSizeClick(): void
{
    pointer.zoomAtCenter(1 / canvasView.view.scale);
}

/**
 * Zooms in about the center.
 */
function handleZoomInClick(): void
{
    pointer.zoomAtCenter(1.25);
}

/**
 * Zooms out about the center.
 */
function handleZoomOutClick(): void
{
    pointer.zoomAtCenter(0.8);
}

/**
 * Switches between panning and drawing a region.
 */
function handleRegionModeClick(): void
{
    state.mode = state.mode === "region" ? "pan" : "region";
    setStatus(state.mode === "region" ? "Drag a rectangle around the tree." : "Ready.");
    updateToolbar();
}

/**
 * Forgets the region so the whole image is analyzed.
 */
function handleClearRegionClick(): void
{
    state.region = null;
    state.draftRegion = null;
    setStatus("Region cleared; the whole image will be analyzed.");
    redraw();
}

/**
 * Selects the tip or node whose list entry was clicked.
 *
 * @param event - Click event from a list.
 */
function handleListClick(event: Event): void
{
    const selection = getSelectionFromEvent(event);

    if (selection !== null)
    {
        select(selection, true);
    }
}

/**
 * Applies an edited label from a list entry to the document.
 *
 * @param event - Input event from a list.
 */
function handleListInput(event: Event): void
{
    const selection = getSelectionFromEvent(event);
    const target = event.target;

    if (selection === null || state.extraction === null || !(target instanceof HTMLInputElement))
    {
        return;
    }

    if (selection.kind === "tip")
    {
        const tip = findTip(state.extraction, selection.id);

        if (tip !== null)
        {
            tip.label = target.value;
            tip.match = null;
            tip.source = "manual";
        }
    }
    else
    {
        const node = findNode(state.extraction, selection.id);

        if (node !== null)
        {
            node.label = target.value.length === 0 ? null : target.value;
            node.source = "manual";
        }
    }

    updateNewick(results, state.extraction);
    redraw();
}

/**
 * Downloads the tree as Newick.
 */
function handleDownloadNewick(): void
{
    if (state.extraction !== null)
    {
        downloadNewickFile(state.extraction, state.fileStem);
    }
}

/**
 * Downloads the tree as Nexus.
 */
function handleDownloadNexus(): void
{
    if (state.extraction !== null)
    {
        downloadNexusFile(state.extraction, state.fileStem);
    }
}

/**
 * Downloads the extraction document.
 */
function handleDownloadJson(): void
{
    if (state.extraction !== null)
    {
        downloadDocumentFile(state.extraction, state.fileStem);
    }
}

/**
 * Redraws when the canvas changes size.
 */
function handleResize(): void
{
    canvasView.resize(state);
    updateToolbar();
}

/**
 * Loads an image named by the page's ?image= query parameter, a convenience for development.
 *
 * @returns Resolves when the image is loaded or when there is none.
 */
async function loadFromQuery(): Promise<void>
{
    const source = new URLSearchParams(location.search).get("image");

    if (source !== null)
    {
        const response = await fetch(source);
        const blob = await response.blob();
        await loadFile(new File([blob], source.split("/").pop() ?? "image", { type: blob.type }));
    }
}

/**
 * Reports a newly dragged-out region.
 *
 * @param region - The region.
 */
function handleRegionSet(region: Box): void
{
    setStatus(`Region set: ${region.x1 - region.x0} × ${region.y1 - region.y0} px at (${region.x0}, ${region.y0}). Extract to analyze only this area.`);
}

/**
 * Selects what was clicked on the canvas.
 *
 * @param selection - Tip, node or null.
 */
function handleCanvasSelect(selection: Selection | null): void
{
    select(selection, false);
}

const pointer = new PointerController(canvas, canvasView, state, {
    onSelect: handleCanvasSelect,
    onRegionSet: handleRegionSet,
    onViewChanged: updateToolbar,
});

fileInput.addEventListener("change", handleFileChange);
document.body.addEventListener("dragover", handleDragOver);
document.body.addEventListener("drop", handleDrop);
runButton.addEventListener("click", handleRunClick);
fitButton.addEventListener("click", handleFitClick);
actualButton.addEventListener("click", handleActualSizeClick);
zoomInButton.addEventListener("click", handleZoomInClick);
zoomOutButton.addEventListener("click", handleZoomOutClick);
regionModeButton.addEventListener("click", handleRegionModeClick);
clearRegionButton.addEventListener("click", handleClearRegionClick);
results.tipsList.addEventListener("click", handleListClick);
results.nodesList.addEventListener("click", handleListClick);
results.tipsList.addEventListener("input", handleListInput);
results.nodesList.addEventListener("input", handleListInput);
downloadNewick.addEventListener("click", handleDownloadNewick);
downloadNexus.addEventListener("click", handleDownloadNexus);
downloadJson.addEventListener("click", handleDownloadJson);
new ResizeObserver(handleResize).observe(canvasWrap);

for (const checkbox of document.querySelectorAll<HTMLInputElement>("input[data-layer]"))
{
    checkbox.addEventListener("change", handleLayerChange);
}

canvasView.resize(state);
updateToolbar();
void loadFromQuery();
