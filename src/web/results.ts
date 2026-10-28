/**
 * The results panel: editable lists of tips and nodes, quality checks and the Newick text.
 */

import type { ExtractionDocument } from "../core/types.ts";
import { formatProfile } from "../core/profile.ts";
import { renderTreeSvg } from "../core/render.ts";
import { formatDocumentAsNewick, getTipDisplayName } from "../core/newick.ts";
import type { Selection } from "./state.ts";
import { collectConnected } from "./lookup.ts";

/**
 * The elements the results panel writes to.
 */
export type ResultElements = {
    /**
     * List of tips.
     */
    tipsList: HTMLOListElement;

    /**
     * List of nodes.
     */
    nodesList: HTMLOListElement;

    /**
     * Shows how many tips there are.
     */
    tipsCount: HTMLSpanElement;

    /**
     * Shows how many nodes there are.
     */
    nodesCount: HTMLSpanElement;

    /**
     * Quality-check findings.
     */
    qcList: HTMLUListElement;

    /**
     * Figure profile lines.
     */
    profileList: HTMLUListElement;

    /**
     * Newick output.
     */
    newickOutput: HTMLTextAreaElement;

    /**
     * Container for the redrawn tree.
     */
    redraw: HTMLElement;

    /**
     * Download buttons, enabled when there is a tree.
     */
    downloadButtons: Array<HTMLButtonElement>;
};

/**
 * Builds one list entry with an identifier and an editable label.
 *
 * @param kind - Tip or node.
 * @param id - Identifier.
 * @param value - Current label text.
 * @param classes - Extra classes describing its state.
 * @returns The list item.
 */
function createListItem(kind: "tip" | "node", id: string, value: string, classes: Array<string>): HTMLLIElement
{
    const item = document.createElement("li");
    item.dataset.kind = kind;
    item.dataset.id = id;

    for (const name of classes)
    {
        item.classList.add(name);
    }

    const label = document.createElement("span");
    label.className = "id";
    label.textContent = id;
    const input = document.createElement("input");
    input.value = value;
    input.placeholder = kind === "tip" ? "(no label)" : "(no support value)";
    item.append(label, input);

    return item;
}

/**
 * Refreshes the Newick text and download buttons from a document.
 *
 * @param elements - Panel elements.
 * @param extraction - Current document, or null.
 */
export function updateNewick(elements: ResultElements, extraction: ExtractionDocument | null): void
{
    const newick = extraction === null ? null : formatDocumentAsNewick(extraction);
    elements.newickOutput.value = extraction === null ? "" : (newick ?? "(no tree found)");
    // The markup is the renderer's own, with every label escaped.
    const svg = extraction === null ? null : renderTreeSvg(extraction);
    elements.redraw.innerHTML = svg ?? "";
    elements.redraw.hidden = svg === null;

    for (const button of elements.downloadButtons)
    {
        button.disabled = newick === null;
    }
}

/**
 * Rebuilds the tips list, nodes list, quality-check list and tree text.
 *
 * @param elements - Panel elements.
 * @param extraction - Current document, or null.
 */
export function renderResults(elements: ResultElements, extraction: ExtractionDocument | null): void
{
    elements.tipsList.replaceChildren();
    elements.nodesList.replaceChildren();
    elements.qcList.replaceChildren();
    elements.profileList.replaceChildren();
    updateNewick(elements, extraction);
    elements.tipsCount.textContent = extraction === null ? "" : `(${extraction.tips.length})`;
    elements.nodesCount.textContent = extraction === null ? "" : `(${extraction.nodes.length})`;

    if (extraction === null)
    {
        return;
    }

    const connected = collectConnected(extraction);

    for (const tip of extraction.tips)
    {
        const classes = new Array<string>();

        if (tip.textLine === null)
        {
            classes.push("unlabelled");
        }
        else if (tip.match !== null && !tip.match.accepted)
        {
            classes.push("unsure");
        }

        if (!connected.has(tip.id))
        {
            classes.push("detached");
        }

        elements.tipsList.append(createListItem("tip", tip.id, getTipDisplayName(extraction, tip.id), classes));
    }

    for (const node of extraction.nodes)
    {
        const classes = new Array<string>();

        if (!connected.has(node.id))
        {
            classes.push("detached");
        }

        elements.nodesList.append(createListItem("node", node.id, node.label ?? "", classes));
    }

    for (const issue of extraction.qc)
    {
        const item = document.createElement("li");
        item.className = issue.severity;
        item.textContent = `${issue.code}: ${issue.message}`;
        elements.qcList.append(item);
    }

    for (const line of formatProfile(extraction.profile))
    {
        const item = document.createElement("li");
        item.textContent = line;
        elements.profileList.append(item);
    }
}

/**
 * Highlights the selected entry in the lists and scrolls it into view.
 *
 * @param elements - Panel elements.
 * @param selection - Current selection, or null.
 */
export function highlightSelection(elements: ResultElements, selection: Selection | null): void
{
    const lists = [elements.tipsList, elements.nodesList];

    for (const list of lists)
    {
        for (const item of list.children)
        {
            if (!(item instanceof HTMLLIElement))
            {
                continue;
            }

            const selected = selection !== null && item.dataset.kind === selection.kind && item.dataset.id === selection.id;
            item.classList.toggle("selected", selected);

            if (selected)
            {
                item.scrollIntoView({ block: "nearest" });
            }
        }
    }
}

/**
 * Reads which list entry an event happened in.
 *
 * @param event - Event from a list.
 * @returns The entry's selection, or null when the event was outside an entry.
 */
export function getSelectionFromEvent(event: Event): Selection | null
{
    const target = event.target;

    if (!(target instanceof HTMLElement))
    {
        return null;
    }

    const item = target.closest("li");

    if (item === null || item.dataset.id === undefined || (item.dataset.kind !== "tip" && item.dataset.kind !== "node"))
    {
        return null;
    }

    return { kind: item.dataset.kind, id: item.dataset.id };
}
