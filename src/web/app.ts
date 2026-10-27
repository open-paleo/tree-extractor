/**
 * Browser viewer: runs the extraction pipeline on a dropped image, draws what it found over the
 * figure, lets the user correct tip names and exports the tree.
 */

import type { ExtractionDocument, OcrEngine, RgbaImage, TreeNode } from "../core/types.ts";
import { extractTree, formatTimings } from "../core/pipeline.ts";
import { formatDocumentAsNewick, getTipDisplayName } from "../core/newick.ts";
import { formatNexus } from "../core/nexus.ts";
import { createTesseractOcr } from "../ocr/tesseract.ts";

type Layers = {
    segments: boolean;
    text: boolean;
    nodes: boolean;
    tips: boolean;
};

const fileInput = document.querySelector<HTMLInputElement>("#file") as HTMLInputElement;
const ocrCheckbox = document.querySelector<HTMLInputElement>("#ocr") as HTMLInputElement;
const namesInput = document.querySelector<HTMLTextAreaElement>("#names") as HTMLTextAreaElement;
const runButton = document.querySelector<HTMLButtonElement>("#run") as HTMLButtonElement;
const statusLine = document.querySelector<HTMLParagraphElement>("#status") as HTMLParagraphElement;
const canvas = document.querySelector<HTMLCanvasElement>("#canvas") as HTMLCanvasElement;
const tipsList = document.querySelector<HTMLOListElement>("#tips") as HTMLOListElement;
const qcList = document.querySelector<HTMLUListElement>("#qc") as HTMLUListElement;
const newickOutput = document.querySelector<HTMLTextAreaElement>("#newick") as HTMLTextAreaElement;
const downloadNewick = document.querySelector<HTMLButtonElement>("#download-newick") as HTMLButtonElement;
const downloadNexus = document.querySelector<HTMLButtonElement>("#download-nexus") as HTMLButtonElement;
const downloadJson = document.querySelector<HTMLButtonElement>("#download-json") as HTMLButtonElement;

let image: RgbaImage | null = null;
let bitmap: ImageBitmap | null = null;
let extraction: ExtractionDocument | null = null;
let ocrEngine: OcrEngine | null = null;
let fileStem = "tree";
const layers: Layers = { segments: true, text: true, nodes: true, tips: true };

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
 * Decodes a file into an RGBA image and shows it.
 *
 * @param file - Image file.
 * @returns Resolves when the image is on screen.
 */
async function loadFile(file: File): Promise<void>
{
    bitmap = await createImageBitmap(file);
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d") as CanvasRenderingContext2D;
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height);
    image = { width: data.width, height: data.height, data: data.data };
    extraction = null;
    fileStem = file.name.replace(/\.[^.]+$/, "");
    runButton.disabled = false;
    setStatus(`${file.name}: ${bitmap.width} × ${bitmap.height} px. Ready.`);
    renderCanvas();
}

/**
 * Draws the image and the overlay for the current layer selection.
 */
function renderCanvas(): void
{
    if (bitmap === null)
    {
        return;
    }

    const context = canvas.getContext("2d") as CanvasRenderingContext2D;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);

    if (extraction === null)
    {
        return;
    }

    const inTree = new Set<string>();
    const nodeById = new Map<string, TreeNode>();

    for (const node of extraction.nodes)
    {
        nodeById.set(node.id, node);
    }

    function visit(id: string): void
    {
        inTree.add(id);
        const node = nodeById.get(id);

        if (node !== undefined)
        {
            for (const child of node.children)
            {
                visit(child);
            }
        }
    }

    if (extraction.root !== null)
    {
        visit(extraction.root);
    }

    if (layers.segments)
    {
        context.fillStyle = "rgba(0, 120, 255, 0.35)";

        for (const segment of extraction.horizontals)
        {
            const { x0, y0, x1, y1 } = segment.box;
            context.fillRect(x0, y0, x1 - x0, y1 - y0);
        }

        context.fillStyle = "rgba(255, 140, 0, 0.35)";

        for (const segment of extraction.verticals)
        {
            const { x0, y0, x1, y1 } = segment.box;
            context.fillRect(x0, y0, x1 - x0, y1 - y0);
        }
    }

    if (layers.text)
    {
        context.lineWidth = 1;

        for (const line of extraction.textLines)
        {
            context.strokeStyle = line.role === "tip" ? "rgba(0, 170, 0, 0.9)" : line.role === "node" ? "rgba(160, 0, 200, 0.9)" : "rgba(160, 160, 160, 0.6)";
            const { x0, y0, x1, y1 } = line.box;
            context.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
        }
    }

    if (layers.nodes)
    {
        context.font = "10px sans-serif";

        for (const node of extraction.nodes)
        {
            const connected = inTree.has(node.id);
            context.fillStyle = connected ? "rgba(255, 80, 0, 0.95)" : "rgba(255, 0, 0, 0.6)";
            const y = node.attachY ?? (node.y0 + node.y1) / 2;
            context.beginPath();
            context.arc(node.x, y, 4, 0, Math.PI * 2);
            context.fill();

            if (node.label !== null)
            {
                context.fillText(node.label, node.x + 6, y - 4);
            }
        }
    }

    if (layers.tips)
    {
        context.font = "10px sans-serif";

        for (const tip of extraction.tips)
        {
            const connected = inTree.has(tip.id);
            context.fillStyle = connected ? "rgba(0, 160, 0, 0.95)" : "rgba(255, 0, 0, 0.9)";
            context.beginPath();
            context.arc(tip.x, tip.y, 3, 0, Math.PI * 2);
            context.fill();
            context.fillText(tip.id, tip.x + 4, tip.y + 12);
        }
    }
}

/**
 * Rebuilds the tips list, quality-check list and tree text from the current document.
 */
function renderResults(): void
{
    tipsList.replaceChildren();
    qcList.replaceChildren();

    if (extraction === null)
    {
        newickOutput.value = "";
        downloadNewick.disabled = true;
        downloadNexus.disabled = true;
        downloadJson.disabled = true;

        return;
    }

    const current = extraction;

    for (const tip of current.tips)
    {
        const item = document.createElement("li");
        const input = document.createElement("input");
        input.value = getTipDisplayName(current, tip.id);

        if (tip.textLine === null)
        {
            item.classList.add("unlabelled");
        }
        else if (tip.match !== null && !tip.match.accepted)
        {
            item.classList.add("unsure");
        }

        input.addEventListener("input", function handleTipEdit(): void
        {
            tip.label = input.value;
            tip.match = null;
            tip.source = "manual";
            newickOutput.value = formatDocumentAsNewick(current) ?? "";
        });

        const id = document.createElement("span");
        id.textContent = tip.id;
        item.append(id, input);
        tipsList.append(item);
    }

    for (const issue of current.qc)
    {
        const item = document.createElement("li");
        item.className = issue.severity;
        item.textContent = `${issue.code}: ${issue.message}`;
        qcList.append(item);
    }

    newickOutput.value = formatDocumentAsNewick(current) ?? "(no tree found)";
    downloadNewick.disabled = current.root === null;
    downloadNexus.disabled = current.root === null;
    downloadJson.disabled = false;
}

/**
 * Offers a text file for download.
 *
 * @param name - File name.
 * @param text - File contents.
 * @param type - Media type.
 */
function downloadText(name: string, text: string, type: string): void
{
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
}

/**
 * Runs the pipeline on the loaded image.
 *
 * @returns Resolves when results are shown.
 */
async function runExtraction(): Promise<void>
{
    if (image === null)
    {
        return;
    }

    runButton.disabled = true;
    const names = new Array<string>();

    for (const line of namesInput.value.split(/\r?\n/))
    {
        if (line.trim().length > 0)
        {
            names.push(line.trim());
        }
    }

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

        setStatus("Tracing…");
        extraction = await extractTree(image, { ocr: ocrCheckbox.checked ? ocrEngine : null, names, source: fileStem });
        setStatus(`${extraction.tips.length} tips, ${extraction.nodes.length} nodes. ${formatTimings(extraction.timings)}.`);
    }
    catch (error)
    {
        setStatus(`Failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    runButton.disabled = false;
    renderCanvas();
    renderResults();
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
    layers[checkbox.dataset.layer as keyof Layers] = checkbox.checked;
    renderCanvas();
}

/**
 * Downloads the tree as Newick.
 */
function handleDownloadNewick(): void
{
    if (extraction !== null)
    {
        downloadText(`${fileStem}.nwk`, `${formatDocumentAsNewick(extraction) ?? ""}\n`, "text/plain");
    }
}

/**
 * Downloads the tree as Nexus.
 */
function handleDownloadNexus(): void
{
    if (extraction === null)
    {
        return;
    }

    const newick = formatDocumentAsNewick(extraction);

    if (newick === null)
    {
        return;
    }

    const taxa = new Array<string>();

    for (const tip of extraction.tips)
    {
        if (tip.parent !== null)
        {
            taxa.push(getTipDisplayName(extraction, tip.id));
        }
    }

    downloadText(`${fileStem}.nex`, formatNexus(newick, taxa, "extracted", `Extracted from ${fileStem} by tree-extractor`), "text/plain");
}

/**
 * Downloads the extraction document.
 */
function handleDownloadJson(): void
{
    if (extraction !== null)
    {
        downloadText(`${fileStem}.json`, JSON.stringify(extraction, null, 2), "application/json");
    }
}

fileInput.addEventListener("change", handleFileChange);
document.body.addEventListener("dragover", handleDragOver);
document.body.addEventListener("drop", handleDrop);
runButton.addEventListener("click", handleRunClick);
downloadNewick.addEventListener("click", handleDownloadNewick);
downloadNexus.addEventListener("click", handleDownloadNexus);
downloadJson.addEventListener("click", handleDownloadJson);

for (const checkbox of document.querySelectorAll<HTMLInputElement>("input[data-layer]"))
{
    checkbox.addEventListener("change", handleLayerChange);
}

void loadFromQuery();
