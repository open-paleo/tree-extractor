/**
 * The viewer as a component: mounts on an element of the host page, wires its controls to the
 * viewer state, the canvas, the results panel and the extraction pipeline, and removes itself
 * again on request. The standalone page and any embedding site use this one function.
 */

import type { ExtractionDocument, OcrEngine } from "../core/types.ts";
import { formatDocumentAsNewick, getNodeDisplayLabel } from "../core/newick.ts";
import type { TesseractLike, TesseractPaths } from "../ocr/tesseract.ts";
import { viewerMarkup } from "./template.ts";
import { formatTimings } from "../core/pipeline.ts";
import { createTesseractOcr } from "../ocr/tesseract.ts";
import type { Box } from "../core/types.ts";
import type { HistoryEntry, Layers, Selection } from "./state.ts";
import { createViewerState } from "./state.ts";
import { CanvasView } from "./canvas.ts";
import { getNodeMarkerY } from "./lookup.ts";
import type { ResultElements } from "./results.ts";
import { getSelectionFromEvent, highlightSelection, renderResults, updateNewick } from "./results.ts";
import { downloadDocumentFile, downloadNewickFile, downloadNexusFile, downloadSvgFile } from "./exports.ts";
import { PointerController } from "./interaction.ts";
import type { EditResult } from "../core/edit.ts";
import { addNode, addTip, deleteNode, deleteTip, findNodeById, findTipById, moveUnder } from "../core/edit.ts";
import { refreshDisconnectedIssues } from "../core/tree.ts";
import { ExtractionClient } from "./extraction-client.ts";

/**
 * What the host page supplies when it mounts the viewer. Every asset is named by the host, so
 * the viewer itself requests nothing from a third party.
 */
export type TreeExtractorOptions = {
    /**
     * URL of the built extraction worker module (dist/web/worker.js).
     */
    workerUrl: string;

    /**
     * Returns the Tesseract.js module, loaded however the host loads it. Without it the viewer
     * traces trees but cannot read labels.
     */
    loadTesseract?: () => TesseractLike | Promise<TesseractLike>;

    /**
     * Where Tesseract.js finds its own worker script, its core and its language data; left to
     * Tesseract's defaults (a public CDN) when absent.
     */
    tesseractPaths?: TesseractPaths;

    /**
     * Known taxon names for the second tier of matching: the names, or the URL of a text file
     * with one name per line.
     */
    knownNames?: Array<string> | string;

    /**
     * URL of an image to load at once.
     */
    image?: string;
};

/**
 * What the host page gets back.
 */
export type TreeExtractorHandle = {
    /**
     * Removes the viewer and everything it set up.
     */
    destroy(): void;

    /**
     * The tree as Newick with the user's edits, or null.
     */
    getNewick(): string | null;

    /**
     * The extraction document with the user's edits, or null.
     */
    getDocument(): ExtractionDocument | null;

    /**
     * Loads an image from a URL.
     *
     * @param source - Image URL.
     */
    loadImage(source: string): Promise<void>;

    /**
     * Replaces the known taxon names used from the next extraction on.
     *
     * @param names - The names.
     */
    setKnownNames(names: Array<string>): void;
};

/**
 * Mounts the viewer on an element. The element is given the class tree-extractor and the
 * viewer's markup; nothing is added outside it.
 *
 * @param root - Element to mount on; its contents are replaced.
 * @param options - Asset locations and initial content.
 * @returns A handle to the mounted viewer.
 */
export function mountTreeExtractor(root: HTMLElement, options: TreeExtractorOptions): TreeExtractorHandle
{
    root.classList.add("tree-extractor");
    root.innerHTML = viewerMarkup;
    const abort = new AbortController();
    const { signal } = abort;

    /**
     * Finds a required element of the viewer.
     *
     * @param selector - CSS selector.
     * @returns The element.
     */
    function getElement<T extends Element>(selector: string): T
    {
        const element = root.querySelector<T>(selector);

        if (element === null)
        {
            throw new Error(`missing element ${selector}`);
        }

        return element;
    }

    const fileInput = getElement<HTMLInputElement>("#te-file");
    const ocrCheckbox = getElement<HTMLInputElement>("#te-ocr");
    const namesInput = getElement<HTMLTextAreaElement>("#te-names");
    let knownNames = new Array<string>();
    const runButton = getElement<HTMLButtonElement>("#te-run");
    const statusLine = getElement<HTMLParagraphElement>("#te-status");
    const progressBar = getElement<HTMLDivElement>("#te-progress");
    const canvasWrap = getElement<HTMLDivElement>("#te-canvas-wrap");
    const canvas = getElement<HTMLCanvasElement>("#te-canvas");
    const fitButton = getElement<HTMLButtonElement>("#te-fit");
    const actualButton = getElement<HTMLButtonElement>("#te-actual");
    const zoomInButton = getElement<HTMLButtonElement>("#te-zoom-in");
    const zoomOutButton = getElement<HTMLButtonElement>("#te-zoom-out");
    const zoomLevel = getElement<HTMLSpanElement>("#te-zoom-level");
    const regionModeButton = getElement<HTMLButtonElement>("#te-region-mode");
    const modeHint = getElement<HTMLParagraphElement>("#te-mode-hint");
    const clearRegionButton = getElement<HTMLButtonElement>("#te-clear-region");
    const addTipButton = getElement<HTMLButtonElement>("#te-add-tip");
    const addNodeButton = getElement<HTMLButtonElement>("#te-add-node");
    const moveButton = getElement<HTMLButtonElement>("#te-move");
    const undoButton = getElement<HTMLButtonElement>("#te-undo");
    const redoButton = getElement<HTMLButtonElement>("#te-redo");
    const deleteButton = getElement<HTMLButtonElement>("#te-delete");
    const selectButton = getElement<HTMLButtonElement>("#te-select");
    const moveRow = getElement<HTMLDivElement>("#te-move-row");
    const moveTarget = getElement<HTMLSelectElement>("#te-move-target");
    const moveApplyButton = getElement<HTMLButtonElement>("#te-move-apply");
    const downloadNewick = getElement<HTMLButtonElement>("#te-download-newick");
    const downloadNexus = getElement<HTMLButtonElement>("#te-download-nexus");
    const downloadJson = getElement<HTMLButtonElement>("#te-download-json");
    const downloadSvg = getElement<HTMLButtonElement>("#te-download-svg");
    const results: ResultElements = {
        tipsList: getElement<HTMLOListElement>("#te-tips"),
        nodesList: getElement<HTMLOListElement>("#te-nodes"),
        tipsCount: getElement<HTMLSpanElement>("#te-tips-count"),
        nodesCount: getElement<HTMLSpanElement>("#te-nodes-count"),
        qcList: getElement<HTMLUListElement>("#te-qc"),
        profileList: getElement<HTMLUListElement>("#te-profile"),
        newickOutput: getElement<HTMLTextAreaElement>("#te-newick"),
        redraw: getElement<HTMLElement>("#te-redraw"),
        downloadButtons: [downloadNewick, downloadNexus, downloadJson, downloadSvg],
    };

    const state = createViewerState();
    const canvasView = new CanvasView(canvas);
    const extractionClient = new ExtractionClient(options.workerUrl);
    let ocrEngine: OcrEngine | null = null;
    let engaged = false;

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
     * Shows, under the toolbar, what the active drawing mode expects, or nothing when panning.
     */
    function updateModeHint(): void
    {
        const hints: Record<string, string> = {
            region: "Drag a rectangle around the tree, then press Extract tree to analyze only that area. Escape cancels.",
            "add-tip": "Click where the new tip's branch ends. Escape cancels.",
            "add-node": "Drag along the missing vertical connector, from its top to its bottom. Escape cancels.",
            move: "Drag a tip or node and drop it on the node it should hang from; a loose piece, drawn in red, is restored by moving its root. Escape leaves move mode.",
        };
        const hint = hints[state.mode];
        modeHint.hidden = hint === undefined;
        modeHint.textContent = hint ?? "";
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
        selectButton.disabled = !extracted;
        selectButton.setAttribute("aria-pressed", String(extracted && (state.mode === "pan" || state.mode === "region")));
        selectButton.classList.toggle("active", extracted && (state.mode === "pan" || state.mode === "region"));
        addTipButton.disabled = !extracted;
        addNodeButton.disabled = !extracted;
        moveButton.disabled = !extracted;
        undoButton.disabled = state.history.length === 0;
        redoButton.disabled = state.future.length === 0;
        deleteButton.disabled = !extracted || state.selection === null;
        regionModeButton.setAttribute("aria-pressed", String(state.mode === "region"));
        addTipButton.setAttribute("aria-pressed", String(state.mode === "add-tip"));
        addNodeButton.setAttribute("aria-pressed", String(state.mode === "add-node"));
        moveButton.setAttribute("aria-pressed", String(state.mode === "move"));
        updateMoveTargets();
        regionModeButton.classList.toggle("active", state.mode === "region");
        addTipButton.classList.toggle("active", state.mode === "add-tip");
        addNodeButton.classList.toggle("active", state.mode === "add-node");
        moveButton.classList.toggle("active", state.mode === "move");
        canvas.classList.toggle("region", state.mode === "region");
        canvas.classList.toggle("add", state.mode === "add-tip" || state.mode === "add-node");
        canvas.classList.toggle("move", state.mode === "move");
        updateModeHint();
    }

    /**
     * Lists the nodes the selection could be moved under, for moving without a pointer.
     */
    function updateMoveTargets(): void
    {
        const extraction = state.extraction;
        const selection = state.selection;
        const wanted = extraction === null || selection === null ? "" : `${selection.id}:${extraction.nodes.length}`;

        if (moveTarget.dataset.for === wanted)
        {
            return;
        }

        moveTarget.dataset.for = wanted;
        moveTarget.replaceChildren();

        if (extraction !== null && selection !== null)
        {
            for (const node of extraction.nodes)
            {
                if (node.id !== selection.id)
                {
                    const option = document.createElement("option");
                    option.value = node.id;
                    option.textContent = getNodeDisplayLabel(node) === null ? node.id : `${node.id} (${getNodeDisplayLabel(node)})`;
                    moveTarget.append(option);
                }
            }
        }

        const usable = moveTarget.options.length > 0;
        moveRow.hidden = !usable;
        moveTarget.disabled = !usable;
        moveApplyButton.disabled = !usable;
    }

    /**
     * Moves the selection under the node chosen in the list.
     */
    function handleMoveApply(): void
    {
        if (state.selection !== null && moveTarget.value.length > 0)
        {
            handleMoveUnder(state.selection, moveTarget.value);
        }
    }

    /**
     * Selects the tip or node whose list entry took the focus, so the lists work from the
     * keyboard as they do with a pointer.
     *
     * @param event - Focus event from a list.
     */
    function handleListFocus(event: Event): void
    {
        const selection = getSelectionFromEvent(event);

        if (selection !== null && (state.selection === null || state.selection.id !== selection.id))
        {
            select(selection, true);
        }
    }

    /**
     * Activates a quality check that names a tip or node, on Enter or Space.
     *
     * @param event - Keyboard event from the quality check list.
     */
    function handleCheckKey(event: KeyboardEvent): void
    {
        if (event.key === "Enter" || event.key === " ")
        {
            event.preventDefault();
            handleListClick(event);
        }
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

        if (state.extraction !== null)
        {
            refreshDisconnectedIssues(state.extraction);
        }

        renderResults(results, state.extraction);
        updateNewick(results, state.extraction);
        select(result.id === null ? null : { kind, id: result.id }, false);
    }

    /**
     * Forgets the edit history, when a new image or a new extraction replaces the document.
     */
    function clearHistory(): void
    {
        state.history = [];
        state.future = [];
        state.lastEditKey = null;
    }

    const historyLimit = 100;

    /**
     * Keeps a copy of the document before an edit, so the edit can be undone. Successive edits
     * with the same key, the keystrokes of one label, share one entry. Redo is discarded.
     *
     * @param key - What is being edited, such as "label:t5".
     * @param description - What the edit does, for the status line.
     */
    function recordEdit(key: string, description: string): void
    {
        if (state.extraction === null)
        {
            return;
        }

        if (key === state.lastEditKey && state.history.length > 0)
        {
            return;
        }

        state.history.push({ document: structuredClone(state.extraction), description });

        if (state.history.length > historyLimit)
        {
            state.history.shift();
        }

        state.future = [];
        state.lastEditKey = key;
    }

    /**
     * Runs an edit against a recorded copy, keeping the copy only when the edit was applied.
     *
     * @param description - What the edit does.
     * @param run - The edit.
     * @param kind - What the edit would have created.
     */
    function applyEdit(description: string, run: () => EditResult, kind: "tip" | "node"): void
    {
        recordEdit(`edit:${state.history.length}:${description}`, description);
        const result = run();

        if (!result.ok)
        {
            state.history.pop();
            state.lastEditKey = null;
        }

        finishEdit(result, kind);
    }

    /**
     * Puts the document back as it was before the last edit, or after the last undone one.
     *
     * @param from - Entries to take from.
     * @param to - Entries to put the current document on.
     * @param verb - "Undid" or "Redid".
     */
    function stepHistory(from: Array<HistoryEntry>, to: Array<HistoryEntry>, verb: string): void
    {
        const entry = from.pop();

        if (entry === undefined || state.extraction === null)
        {
            return;
        }

        to.push({ document: state.extraction, description: entry.description });
        state.extraction = entry.document;
        state.lastEditKey = null;
        refreshDisconnectedIssues(state.extraction);
        renderResults(results, state.extraction);
        updateNewick(results, state.extraction);
        setStatus(`${verb}: ${entry.description}.`);
        select(null, false);
    }

    /**
     * Undoes the last edit.
     */
    function undo(): void
    {
        stepHistory(state.history, state.future, "Undid");
    }

    /**
     * Redoes the last undone edit.
     */
    function redo(): void
    {
        stepHistory(state.future, state.history, "Redid");
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

        const document = state.extraction;
        const selection = state.selection;
        applyEdit(`deleted ${selection.id}`, () => selection.kind === "tip" ? deleteTip(document, selection.id) : deleteNode(document, selection.id), selection.kind);
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
        clearHistory();
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
                if (options.loadTesseract === undefined)
                {
                    throw new Error("no OCR engine was supplied to the viewer");
                }

                setStatus("Starting the OCR engine (the first run loads its language data)…");
                ocrEngine = await createTesseractOcr(await options.loadTesseract(), "eng", options.tesseractPaths);
            }

            setStatus(state.region === null ? "Tracing…" : "Tracing the selected region…");
            state.extraction = await extractionClient.extract({
                image: state.image,
                names: readNames(),
                knownNames,
                region: state.region,
                ocr: ocrCheckbox.checked ? ocrEngine : null,
                source: state.fileStem,
            }, { onProgress: handleProgress });
            state.selection = null;
            clearHistory();
            const turns = state.extraction.image.quarterTurns;

            if (turns !== 0)
            {
                // The pipeline turned the image to put the root on the left; its coordinates refer
                // to the turned image, so the viewer turns its copy the same way and keeps it so.
                await turnLoadedImage(turns);
                state.extraction.image.quarterTurns = 0;
            }

            const turned = turns === 0 ? "" : ` Figure turned ${turns === 1 ? "clockwise" : "counterclockwise"} to put the root on the left.`;
            setStatus(`${state.extraction.tips.length} tips, ${state.extraction.nodes.length} nodes. ${formatTimings(state.extraction.timings)}.${turned}`);
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
     * Turns the loaded image by quarter turns, replacing the bitmap and the pixel data the
     * pipeline works on. The analysis region is dropped, since it was drawn on the old frame.
     *
     * @param quarterTurns - Clockwise quarter turns.
     * @returns Resolves when the turned image is in place.
     */
    async function turnLoadedImage(quarterTurns: number): Promise<void>
    {
        if (state.bitmap === null)
        {
            return;
        }

        const swap = quarterTurns % 2 === 1;
        const scratch = document.createElement("canvas");
        scratch.width = swap ? state.bitmap.height : state.bitmap.width;
        scratch.height = swap ? state.bitmap.width : state.bitmap.height;
        const context = scratch.getContext("2d");

        if (context === null)
        {
            throw new Error("could not get a drawing context");
        }

        context.translate(scratch.width / 2, scratch.height / 2);
        context.rotate(quarterTurns * Math.PI / 2);
        context.drawImage(state.bitmap, -state.bitmap.width / 2, -state.bitmap.height / 2);
        const data = context.getImageData(0, 0, scratch.width, scratch.height);
        state.bitmap = await createImageBitmap(scratch);
        state.image = { width: data.width, height: data.height, data: data.data };
        state.region = null;
        state.draftRegion = null;
        canvasView.resize(state);
        canvasView.fit(state);
    }

    /**
     * Downloads the redrawn tree as SVG.
     */
    function handleDownloadSvg(): void
    {
        if (state.extraction !== null)
        {
            downloadSvgFile(state.extraction, state.fileStem);
        }
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

        recordEdit(`label:${selection.id}`, `edited the label of ${selection.id}`);

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
                // The field shows the clade's name when there is one, and edits what it shows.
                if (node.name !== undefined && node.name !== null)
                {
                    node.name = target.value.length === 0 ? null : target.value;
                }
                else
                {
                    node.label = target.value.length === 0 ? null : target.value;
                }

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
     * Loads an image from a URL.
     *
     * @param source - Image URL.
     * @returns Resolves when the image is on screen.
     */
    async function loadImageFromUrl(source: string): Promise<void>
    {
        const response = await fetch(source);
        const blob = await response.blob();
        await loadFile(new File([blob], source.split("/").pop() ?? "image", { type: blob.type }));
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
        const document = state.extraction;

        if (document !== null)
        {
            applyEdit("added a tip", () => addTip(document, x, y), "tip");
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
        const document = state.extraction;

        if (document !== null)
        {
            applyEdit("added a node", () => addNode(document, x, y0, y1), "node");
        }
    }

    /**
     * Moves a dragged tip or node under the node it was dropped on.
     *
     * @param selection - What was dragged.
     * @param parentId - Node it was dropped on.
     */
    function handleMoveUnder(selection: Selection, parentId: string): void
    {
        const document = state.extraction;

        if (document !== null)
        {
            applyEdit(`moved ${selection.id} under ${parentId}`, () => moveUnder(document, selection.id, parentId), selection.kind);
        }
    }

    /**
     * Returns to selecting and panning.
     */
    function handleSelectClick(): void
    {
        state.mode = "pan";
        state.draftSpan = null;
        state.draftMove = null;
        updateToolbar();
    }

    /**
     * Enters or leaves move mode.
     */
    function handleMoveClick(): void
    {
        state.mode = state.mode === "move" ? "pan" : "move";
        updateToolbar();
    }

    /**
     * Enters or leaves add-tip mode.
     */
    function handleAddTipClick(): void
    {
        state.mode = state.mode === "add-tip" ? "pan" : "add-tip";
        updateToolbar();
    }

    /**
     * Enters or leaves add-node mode.
     */
    function handleAddNodeClick(): void
    {
        state.mode = state.mode === "add-node" ? "pan" : "add-node";
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
        const inside = target instanceof Node && root.contains(target);

        // A button that disables itself when pressed (Undo with nothing left to undo) drops
        // the focus to the page body, so keys there still count while the viewer was the last
        // thing the user touched.
        if (!inside && !(engaged && target === document.body))
        {
            return;
        }

        const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

        const shortcut = event.metaKey || event.ctrlKey;

        if (!typing && (event.key === "Delete" || event.key === "Backspace"))
        {
            event.preventDefault();
            deleteSelection();
        }
        else if (!typing && shortcut && (event.key === "z" || event.key === "Z"))
        {
            event.preventDefault();

            if (event.shiftKey)
            {
                redo();
            }
            else
            {
                undo();
            }
        }
        else if (!typing && shortcut && event.key === "y")
        {
            event.preventDefault();
            redo();
        }
        else if (!typing && event.key === "Escape" && state.mode !== "pan")
        {
            state.mode = "pan";
            state.draftRegion = null;
            state.draftSpan = null;
            state.draftMove = null;
            setStatus("Ready.");
            redraw();
        }
    }

    /**
     * Notes whether the user's last press or focus was inside the viewer.
     *
     * @param event - Pointer or focus event anywhere on the page.
     */
    function handleEngagement(event: Event): void
    {
        engaged = event.target instanceof Node && root.contains(event.target);
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
        onMoveUnder: handleMoveUnder,
        onViewChanged: updateToolbar,
    });

    fileInput.addEventListener("change", handleFileChange, { signal });
    root.addEventListener("dragover", handleDragOver, { signal });
    root.addEventListener("drop", handleDrop, { signal });
    runButton.addEventListener("click", handleRunClick, { signal });
    fitButton.addEventListener("click", handleFitClick, { signal });
    actualButton.addEventListener("click", handleActualSizeClick, { signal });
    zoomInButton.addEventListener("click", handleZoomInClick, { signal });
    zoomOutButton.addEventListener("click", handleZoomOutClick, { signal });
    regionModeButton.addEventListener("click", handleRegionModeClick, { signal });
    clearRegionButton.addEventListener("click", handleClearRegionClick, { signal });
    addTipButton.addEventListener("click", handleAddTipClick, { signal });
    addNodeButton.addEventListener("click", handleAddNodeClick, { signal });
    selectButton.addEventListener("click", handleSelectClick, { signal });
    moveButton.addEventListener("click", handleMoveClick, { signal });
    undoButton.addEventListener("click", undo, { signal });
    redoButton.addEventListener("click", redo, { signal });
    deleteButton.addEventListener("click", handleDeleteClick, { signal });
    document.addEventListener("keydown", handleKeyDown, { signal });
    document.addEventListener("pointerdown", handleEngagement, { signal, capture: true });
    document.addEventListener("focusin", handleEngagement, { signal });
    results.tipsList.addEventListener("click", handleListClick, { signal });
    results.nodesList.addEventListener("click", handleListClick, { signal });
    results.qcList.addEventListener("click", handleListClick, { signal });
    results.tipsList.addEventListener("focusin", handleListFocus, { signal });
    results.nodesList.addEventListener("focusin", handleListFocus, { signal });
    results.qcList.addEventListener("keydown", handleCheckKey, { signal });
    moveApplyButton.addEventListener("click", handleMoveApply, { signal });
    results.tipsList.addEventListener("input", handleListInput, { signal });
    results.nodesList.addEventListener("input", handleListInput, { signal });
    downloadNewick.addEventListener("click", handleDownloadNewick, { signal });
    downloadNexus.addEventListener("click", handleDownloadNexus, { signal });
    downloadJson.addEventListener("click", handleDownloadJson, { signal });
    downloadSvg.addEventListener("click", handleDownloadSvg, { signal });
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(canvasWrap);

    for (const checkbox of root.querySelectorAll<HTMLInputElement>("input[data-layer]"))
    {
        checkbox.addEventListener("change", handleLayerChange, { signal });
    }

    canvasView.resize(state);
    updateToolbar();

    /**
     * Reads a list of names from text, one per non-blank line.
     *
     * @param text - The text.
     * @returns The names.
     */
    function splitNames(text: string): Array<string>
    {
        const names = new Array<string>();

        for (const line of text.split(/\r?\n/))
        {
            if (line.trim().length > 0)
            {
                names.push(line.trim());
            }
        }

        return names;
    }

    /**
     * Loads the known taxa for the second tier of name matching, from the list or the URL the host
     * supplied. A missing list only means the tier is off.
     *
     * @returns Resolves when the names are in place.
     */
    async function loadKnownNames(): Promise<void>
    {
        if (Array.isArray(options.knownNames))
        {
            knownNames = options.knownNames;

            return;
        }

        if (options.knownNames === undefined)
        {
            return;
        }

        try
        {
            const response = await fetch(options.knownNames);
            knownNames = response.ok ? splitNames(await response.text()) : [];
        }
        catch
        {
            knownNames = [];
        }
    }

    void loadKnownNames();

    if (options.image !== undefined)
    {
        void loadImageFromUrl(options.image);
    }

    /**
     * Removes the viewer: its listeners, its worker, its OCR engine and its markup.
     */
    function destroy(): void
    {
        abort.abort();
        resizeObserver.disconnect();
        extractionClient.terminate();

        if (ocrEngine !== null)
        {
            void ocrEngine.terminate();
        }

        root.classList.remove("tree-extractor");
        root.replaceChildren();
    }

    /**
     * The tree as Newick, as it stands with the user's edits.
     *
     * @returns Newick text, or null before an extraction or when no tree was found.
     */
    function getNewick(): string | null
    {
        return state.extraction === null ? null : formatDocumentAsNewick(state.extraction);
    }

    /**
     * The extraction document, as it stands with the user's edits.
     *
     * @returns The document, or null before an extraction.
     */
    function getDocument(): ExtractionDocument | null
    {
        return state.extraction;
    }

    /**
     * Replaces the known taxon names.
     *
     * @param names - The names.
     */
    function setKnownNames(names: Array<string>): void
    {
        knownNames = names;
    }

    return { destroy, getNewick, getDocument, loadImage: loadImageFromUrl, setKnownNames };
}
