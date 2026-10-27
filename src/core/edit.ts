/**
 * Manual edits to an extraction document: adding and removing tips and nodes. Each edit keeps
 * the tree consistent (children ordered top to bottom, parents updated, degenerate nodes
 * collapsed) and records that the element was made by hand.
 */

import type { ExtractionDocument, Tip, TreeNode } from "./types.ts";
import { cleanTaxonText, isLabelSized } from "./labels.ts";

/**
 * Outcome of an edit.
 */
export type EditResult = {
    /**
     * Whether the edit was applied.
     */
    ok: boolean;

    /**
     * What happened, for the status line.
     */
    message: string;

    /**
     * Identifier of the element created, when one was.
     */
    id: string | null;
};

/**
 * Finds a tip by identifier.
 *
 * @param document - Document to search.
 * @param id - Tip identifier.
 * @returns The tip, or null.
 */
export function findTipById(document: ExtractionDocument, id: string): Tip | null
{
    for (const tip of document.tips)
    {
        if (tip.id === id)
        {
            return tip;
        }
    }

    return null;
}

/**
 * Finds a node by identifier.
 *
 * @param document - Document to search.
 * @param id - Node identifier.
 * @returns The node, or null.
 */
export function findNodeById(document: ExtractionDocument, id: string): TreeNode | null
{
    for (const node of document.nodes)
    {
        if (node.id === id)
        {
            return node;
        }
    }

    return null;
}

/**
 * Height at which a child hangs off its parent: a tip's branch, or a node's junction.
 *
 * @param document - Document.
 * @param id - Tip or node identifier.
 * @returns Image y.
 */
export function getChildHeight(document: ExtractionDocument, id: string): number
{
    const tip = findTipById(document, id);

    if (tip !== null)
    {
        return tip.y;
    }

    const node = findNodeById(document, id);

    if (node !== null)
    {
        return node.attachY ?? (node.y0 + node.y1) / 2;
    }

    return 0;
}

/**
 * Horizontal position of a child: a tip's end, or a node's vertical.
 *
 * @param document - Document.
 * @param id - Tip or node identifier.
 * @returns Image x.
 */
function getChildX(document: ExtractionDocument, id: string): number
{
    const tip = findTipById(document, id);

    if (tip !== null)
    {
        return tip.x;
    }

    return findNodeById(document, id)?.x ?? 0;
}

/**
 * Orders a node's children top to bottom.
 *
 * @param document - Document.
 * @param node - Node whose children are sorted in place.
 */
function sortChildren(document: ExtractionDocument, node: TreeNode): void
{
    function compareHeights(left: string, right: string): number
    {
        return getChildHeight(document, left) - getChildHeight(document, right);
    }

    node.children.sort(compareHeights);
}

/**
 * Makes an identifier that no element of the document uses.
 *
 * @param document - Document.
 * @param prefix - "t" for tips, "n" for nodes.
 * @returns A fresh identifier.
 */
function createId(document: ExtractionDocument, prefix: string): string
{
    let highest = 0;

    for (const tip of document.tips)
    {
        highest = Math.max(highest, readNumber(tip.id, prefix));
    }

    for (const node of document.nodes)
    {
        highest = Math.max(highest, readNumber(node.id, prefix));
    }

    return `${prefix}${highest + 1}`;
}

/**
 * Reads the number from an identifier with the given prefix.
 *
 * @param id - Identifier such as "t12".
 * @param prefix - Expected prefix.
 * @returns The number, or 0 when the prefix does not match.
 */
function readNumber(id: string, prefix: string): number
{
    if (!id.startsWith(prefix))
    {
        return 0;
    }

    const value = Number(id.slice(prefix.length));

    return Number.isFinite(value) ? value : 0;
}

/**
 * Removes a child from a node's list.
 *
 * @param node - Parent node.
 * @param childId - Child to remove.
 */
function removeChild(node: TreeNode, childId: string): void
{
    const index = node.children.indexOf(childId);

    if (index >= 0)
    {
        node.children.splice(index, 1);
    }
}

/**
 * Removes a node that has lost its children: with none it disappears, with one its child takes
 * its place. Repeats upward while parents become degenerate.
 *
 * @param document - Document updated in place.
 * @param nodeId - Node to check.
 */
function collapseDegenerateNode(document: ExtractionDocument, nodeId: string): void
{
    const node = findNodeById(document, nodeId);

    if (node === null || node.children.length >= 2)
    {
        return;
    }

    const parent = node.parent === null ? null : findNodeById(document, node.parent);
    const childId = node.children.length === 1 ? node.children[0] : null;

    if (childId !== null)
    {
        const child = findTipById(document, childId) ?? findNodeById(document, childId);

        if (child !== null)
        {
            child.parent = node.parent;
        }
    }

    if (parent !== null)
    {
        const index = parent.children.indexOf(node.id);

        if (index >= 0 && childId !== null)
        {
            parent.children[index] = childId;
        }
        else if (index >= 0)
        {
            parent.children.splice(index, 1);
        }
    }

    if (document.root === node.id)
    {
        document.root = childId !== null && findNodeById(document, childId) !== null ? childId : null;
    }

    const remaining = new Array<TreeNode>();

    for (const candidate of document.nodes)
    {
        if (candidate.id !== node.id)
        {
            remaining.push(candidate);
        }
    }

    document.nodes = remaining;

    if (parent !== null)
    {
        collapseDegenerateNode(document, parent.id);
    }
}

/**
 * Deletes a tip. A parent left with one child collapses.
 *
 * @param document - Document updated in place.
 * @param id - Tip identifier.
 * @returns The outcome.
 */
export function deleteTip(document: ExtractionDocument, id: string): EditResult
{
    const tip = findTipById(document, id);

    if (tip === null)
    {
        return { ok: false, message: `no tip ${id}`, id: null };
    }

    const remaining = new Array<Tip>();

    for (const candidate of document.tips)
    {
        if (candidate.id !== id)
        {
            remaining.push(candidate);
        }
    }

    document.tips = remaining;

    for (const line of document.textLines)
    {
        if (line.id === tip.textLine)
        {
            line.role = "unassigned";
        }
    }

    const parent = tip.parent === null ? null : findNodeById(document, tip.parent);

    if (parent !== null)
    {
        removeChild(parent, id);
        collapseDegenerateNode(document, parent.id);
    }

    return { ok: true, message: `deleted tip ${id}`, id: null };
}

/**
 * Deletes a node, handing its children to its parent (a polytomy there). The root can only be
 * deleted when it has a single node child, which becomes the root.
 *
 * @param document - Document updated in place.
 * @param id - Node identifier.
 * @returns The outcome.
 */
export function deleteNode(document: ExtractionDocument, id: string): EditResult
{
    const node = findNodeById(document, id);

    if (node === null)
    {
        return { ok: false, message: `no node ${id}`, id: null };
    }

    const parent = node.parent === null ? null : findNodeById(document, node.parent);

    if (parent === null)
    {
        const onlyChild = node.children.length === 1 ? findNodeById(document, node.children[0]) : null;

        if (onlyChild === null)
        {
            return { ok: false, message: `${id} is the root; delete its children first or add a node above it`, id: null };
        }

        onlyChild.parent = null;
        document.root = document.root === id ? onlyChild.id : document.root;
    }
    else
    {
        removeChild(parent, id);

        for (const childId of node.children)
        {
            const child = findTipById(document, childId) ?? findNodeById(document, childId);

            if (child !== null)
            {
                child.parent = parent.id;
            }

            parent.children.push(childId);
        }

        sortChildren(document, parent);
    }

    for (const line of document.textLines)
    {
        if (line.id === node.textLine)
        {
            line.role = "unassigned";
        }
    }

    const remaining = new Array<TreeNode>();

    for (const candidate of document.nodes)
    {
        if (candidate.id !== id)
        {
            remaining.push(candidate);
        }
    }

    document.nodes = remaining;

    return { ok: true, message: `deleted node ${id}; its children now hang from ${parent === null ? "the root" : parent.id}`, id: null };
}

/**
 * Finds the node whose vertical lies nearest to the left of a position and overlaps a span of
 * heights: the parent that a branch or connector at that position would hang from.
 *
 * @param document - Document.
 * @param x - Position whose parent is wanted.
 * @param y0 - Top of the span.
 * @param y1 - Bottom of the span.
 * @param slack - How far beyond a node's span the heights may lie.
 * @returns The parent, or null.
 */
export function findParentForPosition(document: ExtractionDocument, x: number, y0: number, y1: number, slack: number): TreeNode | null
{
    let best: TreeNode | null = null;

    for (const node of document.nodes)
    {
        const overlaps = y1 >= node.y0 - slack && y0 <= node.y1 + slack;

        if (node.x < x - 1 && overlaps && (best === null || node.x > best.x))
        {
            best = node;
        }
    }

    return best;
}

/**
 * Gives a new tip the nearest unassigned text line to its right, if there is one.
 *
 * @param document - Document.
 * @param tip - Tip updated in place.
 */
function assignNearestTextLine(document: ExtractionDocument, tip: Tip): void
{
    const glyph = document.glyphHeight;
    let bestDistance = Infinity;
    let bestIndex = -1;

    for (let index = 0; index < document.textLines.length; index++)
    {
        const line = document.textLines[index];
        const center = (line.box.y0 + line.box.y1) / 2;
        const offset = line.box.x0 - tip.x;

        if (line.role !== "unassigned" || !isLabelSized(line, glyph) || Math.abs(center - tip.y) > 0.8 * glyph || offset < -1.5 * glyph || offset > 5 * glyph)
        {
            continue;
        }

        const distance = Math.abs(offset) + Math.abs(center - tip.y);

        if (distance < bestDistance)
        {
            bestDistance = distance;
            bestIndex = index;
        }
    }

    if (bestIndex < 0)
    {
        return;
    }

    const line = document.textLines[bestIndex];
    line.role = "tip";
    tip.textLine = line.id;

    if (line.ocr !== null)
    {
        const cleaned = cleanTaxonText(line.ocr.text);
        tip.label = cleaned.length > 0 ? cleaned : null;
    }
}

/**
 * Adds a tip at a position, hanging from the node whose vertical is nearest on the left.
 *
 * @param document - Document updated in place.
 * @param x - Branch end x.
 * @param y - Branch height.
 * @returns The outcome, with the new tip's identifier.
 */
export function addTip(document: ExtractionDocument, x: number, y: number): EditResult
{
    const parent = findParentForPosition(document, x, y, y, document.glyphHeight);
    const tip: Tip = {
        id: createId(document, "t"),
        x,
        y,
        parent: parent === null ? null : parent.id,
        textLine: null,
        label: null,
        match: null,
        source: "manual",
    };
    assignNearestTextLine(document, tip);
    document.tips.push(tip);

    if (parent === null)
    {
        return { ok: true, message: `added tip ${tip.id}, but no node lies to its left; it is not connected`, id: tip.id };
    }

    parent.children.push(tip.id);
    sortChildren(document, parent);

    return { ok: true, message: `added tip ${tip.id} under ${parent.id}`, id: tip.id };
}

/**
 * Adds a node whose vertical runs from y0 to y1 at x. It takes over the children of the node to
 * its left whose branches cross the new vertical, which is what drawing the missing connector
 * on the figure means.
 *
 * @param document - Document updated in place.
 * @param x - Position of the vertical.
 * @param y0 - Top of the vertical.
 * @param y1 - Bottom of the vertical.
 * @returns The outcome, with the new node's identifier.
 */
export function addNode(document: ExtractionDocument, x: number, y0: number, y1: number): EditResult
{
    const slack = document.glyphHeight;
    const parent = findParentForPosition(document, x, y0, y1, slack);

    if (parent === null)
    {
        return { ok: false, message: "no node lies to the left of that position to hang the new node from", id: null };
    }

    const taken = new Array<string>();
    const kept = new Array<string>();

    for (const childId of parent.children)
    {
        const height = getChildHeight(document, childId);

        if (height >= y0 - slack && height <= y1 + slack && getChildX(document, childId) > x)
        {
            taken.push(childId);
        }
        else
        {
            kept.push(childId);
        }
    }

    if (taken.length === 0)
    {
        return { ok: false, message: `no branches of ${parent.id} cross that vertical`, id: null };
    }

    const node: TreeNode = {
        id: createId(document, "n"),
        x,
        y0: Math.min(y0, y1),
        y1: Math.max(y0, y1),
        attachY: (y0 + y1) / 2,
        parent: parent.id,
        children: taken,
        textLine: null,
        label: null,
        source: "manual",
    };

    for (const childId of taken)
    {
        const child = findTipById(document, childId) ?? findNodeById(document, childId);

        if (child !== null)
        {
            child.parent = node.id;
        }
    }

    document.nodes.push(node);
    sortChildren(document, node);
    kept.push(node.id);
    parent.children = kept;
    sortChildren(document, parent);

    return { ok: true, message: `added node ${node.id} under ${parent.id} with ${taken.length} child(ren)`, id: node.id };
}
