/**
 * Browser viewer entry point: wires the page's elements to the viewer state, the canvas, the
 * results panel and the extraction pipeline.
 */

import type { OcrEngine } from "../core/types.ts";
import { formatTimings } from "../core/pipeline.ts";
import { createTesseractOcr } from "../ocr/tesseract.ts";
import type { Box } from "../core/types.ts";
import type { Layers, Selection } from "./state.ts";
import { createViewerState } from "./state.ts";
import { CanvasView } from "./canvas.ts";
import { getNodeMarkerY } from "./lookup.ts";
import type { ResultElements } from "./results.ts";
import { getSelectionFromEvent, highlightSelection, renderResults, updateNewick } from "./results.ts";
import { downloadDocumentFile, downloadNewickFile, downloadNexusFile } from "./exports.ts";
import { PointerController } from "./interaction.ts";
import type { EditResult } from "../core/edit.ts";
import { addNode, addTip, deleteNode, deleteTip, findNodeById, findTipById } from "../core/edit.ts";
import { ExtractionClient } from "./extraction-client.ts";

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
const progressBar = getElement<HTMLDivElement>("#progress");
const canvasWrap = getElement<HTMLDivElement>("#canvas-wrap");
const canvas = getElement<HTMLCanvasElement>("#canvas");
const fitButton = getElement<HTMLButtonElement>("#fit");
const actualButton = getElement<HTMLButtonElement>("#actual");
const zoomInButton = getElement<HTMLButtonElement>("#zoom-in");
const zoomOutButton = getElement<HTMLButtonElement>("#zoom-out");
const zoomLevel = getElement<HTMLSpanElement>("#zoom-level");
const regionModeButton = getElement<HTMLButtonElement>("#region-mode");
const clearRegionButton = getElement<HTMLButtonElement>("#clear-region");
const addTipButton = getElement<HTMLButtonElement>("#add-tip");
const addNodeButton = getElement<HTMLButtonElement>("#add-node");
const deleteButton = getElement<HTMLButtonElement>("#delete");
const downloadNewick = getElement<HTMLButtonElement>("#download-newick");
const downloadNexus = getElement<HTMLButtonElement>("#download-nexus");
const downloadJson = getElement<HTMLButtonElement>("#download-json");
const results: ResultElements = {
    tipsList: getElement<HTMLOListElement>("#tips"),
    nodesList: getElement<HTMLOListElement>("#nodes"),
    tipsCount: getElement<HTMLSpanElement>("#tips-count"),
    nodesCount: getElement<HTMLSpanElement>("#nodes-count"),
    qcList: getElement<HTMLUListElement>("#qc"),
    profileList: getElement<HTMLUListElement>("#profile"),
    newickOutput: getElement<HTMLTextAreaElement>("#newick"),
    downloadButtons: [downloadNewick, downloadNexus, downloadJson],
};

const state = createViewerState();
const canvasView = new CanvasView(canvas);
const extractionClient = new ExtractionClient(new URL("./worker.js", import.meta.url).href);
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
    const extracted = state.extraction !== null;
    addTipButton.disabled = !extracted;
    addNodeButton.disabled = !extracted;
    deleteButton.disabled = !extracted || state.selection === null;
    regionModeButton.classList.toggle("active", state.mode === "region");
    addTipButton.classList.toggle("active", state.mode === "add-tip");
    addNodeButton.classList.toggle("active", state.mode === "add-node");
    canvas.classList.toggle("region", state.mode === "region");
    canvas.classList.toggle("add", state.mode === "add-tip" || state.mode === "add-node");
}

/**
 * Applies the outcome of an edit: reports it, rebuilds the lists and selects what was made.
 *
 * @param result - Outcome of the edit.
 * @param kind - What the edit would have created.
 */
function finishEdit(result: EditResult, kind: "tip" | "node"): void
{
    setStatus(result.message);

    if (!result.ok)
    {
        redraw();

        return;
    }

    renderResults(results, state.extraction);
    updateNewick(results, state.extraction);
    select(result.id === null ? null : { kind, id: result.id }, false);
}

/**
 * Deletes the selected tip or node.
 */
function deleteSelection(): void
{
    if (state.extraction === null || state.selection === null)
    {
        return;
    }

    const result = state.selection.kind === "tip"
        ? deleteTip(state.extraction, state.selection.id)
        : deleteNode(state.extraction, state.selection.id);
    finishEdit(result, state.selection.kind);
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
            const tip = findTipById(state.extraction, next.id);

            if (tip !== null)
            {
                canvasView.ensureVisible(state, tip.x, tip.y);
            }
        }
        else
        {
            const node = findNodeById(state.extraction, next.id);

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
    state.draftSpan = null;
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
    progressBar.hidden = false;

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
        state.extraction = await extractionClient.extract({
            image: state.image,
            names: readNames(),
            region: state.region,
            ocr: ocrCheckbox.checked ? ocrEngine : null,
            source: state.fileStem,
        }, { onProgress: handleProgress });
        state.selection = null;
        setStatus(`${state.extraction.tips.length} tips, ${state.extraction.nodes.length} nodes. ${formatTimings(state.extraction.timings)}.`);
    }
    catch (error)
    {
        setStatus(`Failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    progressBar.hidden = true;
    runButton.disabled = false;
    renderResults(results, state.extraction);
    select(null, false);
}

/**
 * Shows pipeline progress in the status line.
 *
 * @param stage - Stage description.
 * @param done - Items done, or 0.
 * @param total - Items in total, or 0.
 */
function handleProgress(stage: string, done: number, total: number): void
{
    setStatus(total > 0 ? `${stage} (${done} of ${total})…` : `${stage}…`);
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
        const tip = findTipById(state.extraction, selection.id);

        if (tip !== null)
        {
            tip.label = target.value;
            tip.match = null;
            tip.source = "manual";
        }
    }
    else
    {
        const node = findNodeById(state.extraction, selection.id);

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
 * Adds a tip where the user clicked.
 *
 * @param x - Branch end x.
 * @param y - Branch height.
 */
function handleAddTip(x: number, y: number): void
{
    if (state.extraction !== null)
    {
        finishEdit(addTip(state.extraction, x, y), "tip");
    }
}

/**
 * Adds a node along the vertical the user dragged.
 *
 * @param x - Position of the vertical.
 * @param y0 - Top.
 * @param y1 - Bottom.
 */
function handleAddNode(x: number, y0: number, y1: number): void
{
    if (state.extraction !== null)
    {
        finishEdit(addNode(state.extraction, x, y0, y1), "node");
    }
}

/**
 * Enters or leaves add-tip mode.
 */
function handleAddTipClick(): void
{
    state.mode = state.mode === "add-tip" ? "pan" : "add-tip";
    setStatus(state.mode === "add-tip" ? "Click where the new tip's branch ends." : "Ready.");
    updateToolbar();
}

/**
 * Enters or leaves add-node mode.
 */
function handleAddNodeClick(): void
{
    state.mode = state.mode === "add-node" ? "pan" : "add-node";
    setStatus(state.mode === "add-node" ? "Drag along the missing vertical connector, from its top to its bottom." : "Ready.");
    updateToolbar();
}

/**
 * Deletes the selection from the toolbar button.
 */
function handleDeleteClick(): void
{
    deleteSelection();
}

/**
 * Deletes the selection on the Delete or Backspace key, unless typing in a field.
 *
 * @param event - Keyboard event.
 */
function handleKeyDown(event: KeyboardEvent): void
{
    const target = event.target;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

    if (!typing && (event.key === "Delete" || event.key === "Backspace"))
    {
        event.preventDefault();
        deleteSelection();
    }
    else if (!typing && event.key === "Escape" && state.mode !== "pan")
    {
        state.mode = "pan";
        state.draftRegion = null;
        state.draftSpan = null;
        setStatus("Ready.");
        redraw();
    }
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
    onAddTip: handleAddTip,
    onAddNode: handleAddNode,
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
addTipButton.addEventListener("click", handleAddTipClick);
addNodeButton.addEventListener("click", handleAddNodeClick);
deleteButton.addEventListener("click", handleDeleteClick);
document.addEventListener("keydown", handleKeyDown);
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
