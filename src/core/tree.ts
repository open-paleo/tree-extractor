/**
 * Traversal helpers over the tree part of an extraction document.
 */

import type { ExtractionDocument, QcIssue, Tip, TreeNode } from "./types.ts";
import { collapseDegenerateNode } from "./edit.ts";

/**
 * Collects the identifiers reachable from the root.
 *
 * @param document - Document to walk.
 * @returns Identifiers of connected nodes and tips.
 */
export function collectConnected(document: ExtractionDocument): Set<string>
{
    const nodeById = new Map<string, TreeNode>();

    for (const node of document.nodes)
    {
        nodeById.set(node.id, node);
    }

    const connected = new Set<string>();

    function visit(id: string): void
    {
        connected.add(id);
        const node = nodeById.get(id);

        if (node !== undefined)
        {
            for (const child of node.children)
            {
                visit(child);
            }
        }
    }

    if (document.root !== null)
    {
        visit(document.root);
    }

    return connected;
}

/**
 * Counts the tips under a node.
 *
 * @param document - Document.
 * @param id - Node identifier.
 * @returns Number of tips reachable.
 */
function countTipsUnder(document: ExtractionDocument, id: string): number
{
    const nodeById = new Map<string, TreeNode>();

    for (const node of document.nodes)
    {
        nodeById.set(node.id, node);
    }

    let count = 0;

    function visit(current: string): void
    {
        const node = nodeById.get(current);

        if (node === undefined)
        {
            count++;

            return;
        }

        for (const child of node.children)
        {
            visit(child);
        }
    }

    visit(id);

    return count;
}

/**
 * Makes the piece with the most tips the main tree. The trace picks a root before debris and
 * decorations are removed, and a chart or a frame can have more pieces then than the tree; once
 * they are gone the real tree is the largest.
 *
 * @param document - Document updated in place.
 * @param byNames - Prefer the piece with the most tips that carry an accepted name.
 * @returns True when the root changed.
 */
export function chooseRoot(document: ExtractionDocument, byNames = false): boolean
{
    let best: string | null = null;
    let bestSize = 0;
    let bestNamed = 0;

    // Once labels are read, the piece with the most named tips is the tree: a stratigraphic
    // chart or a frame can have more ends than the tree, but none of them reads as a taxon.
    // Fewer than three names decide nothing, since without a taxon list a stray piece can
    // carry a name or two from the known taxa while the tree carries none.
    for (const node of document.nodes)
    {
        if (node.parent !== null)
        {
            continue;
        }

        const size = countTipsUnder(document, node.id);
        const namedUnder = byNames ? countNamedTipsUnder(document, node.id) : 0;
        const named = namedUnder >= 3 ? namedUnder : 0;

        if (named > bestNamed || (named === bestNamed && size > bestSize))
        {
            best = node.id;
            bestSize = size;
            bestNamed = named;
        }
    }

    if (best === null || best === document.root)
    {
        return false;
    }

    document.root = best;

    return true;
}

/**
 * Counts the tips under a node that carry an accepted name.
 *
 * @param document - Document.
 * @param rootId - Node to count under.
 * @returns Named tips.
 */
function countNamedTipsUnder(document: ExtractionDocument, rootId: string): number
{
    const nodeById = new Map<string, TreeNode>();
    const tipById = new Map<string, Tip>();

    for (const node of document.nodes)
    {
        nodeById.set(node.id, node);
    }

    for (const tip of document.tips)
    {
        tipById.set(tip.id, tip);
    }

    let named = 0;
    const pending = [rootId];

    while (pending.length > 0)
    {
        const id = pending.pop() as string;
        const node = nodeById.get(id);

        if (node !== undefined)
        {
            pending.push(...node.children);
            continue;
        }

        const tip = tipById.get(id);

        if (tip !== undefined && tip.match !== null && tip.match.accepted)
        {
            named++;
        }
    }

    return named;
}

/**
 * Dissolves every node with fewer than two children, repeating until none is left: a node
 * whose only child was lost is no split, and a node with no child at all is a junction the
 * trace found nothing beyond.
 *
 * @param document - Document updated in place.
 * @returns Number of nodes dissolved.
 */
export function pruneDegenerateNodes(document: ExtractionDocument): number
{
    let dissolved = 0;
    let found = true;

    while (found)
    {
        found = false;

        for (const node of document.nodes)
        {
            if (node.children.length < 2)
            {
                collapseDegenerateNode(document, node.id);
                dissolved++;
                found = true;
                break;
            }
        }
    }

    return dissolved;
}

/**
 * Replaces the quality checks about disconnected pieces with ones that match the document as
 * it stands: the trace records them before later steps dissolve nodes, drop tips and choose
 * the root again, and an issue naming an element that no longer exists leads nowhere.
 *
 * @param document - Document updated in place.
 */
export function refreshDisconnectedIssues(document: ExtractionDocument): void
{
    const kept = new Array<QcIssue>();

    for (const issue of document.qc)
    {
        if (issue.code !== "disconnected-subtree" && issue.code !== "disconnected-tip")
        {
            kept.push(issue);
        }
    }

    for (const node of document.nodes)
    {
        if (node.parent === null && node.id !== document.root)
        {
            kept.push({ severity: "warning", code: "disconnected-subtree", message: `node ${node.id} roots a disconnected subtree with ${countTipsUnder(document, node.id)} tip(s)`, subject: node.id });
        }
    }

    for (const tip of document.tips)
    {
        if (tip.parent === null)
        {
            kept.push({ severity: "warning", code: "disconnected-tip", message: `tip ${tip.id} is not connected to any node`, subject: tip.id });
        }
    }

    document.qc = kept;
}

/**
 * Gives every branch of a phylogram its length in pixels: the distance from the parent's
 * junction to the child's junction or branch end. Meant for a figure whose tips do not line
 * up and whose time axis, if any, could not be read, where the drawn lengths carry the only
 * information there is; a cladogram's lengths mean nothing, and ages from an axis are better.
 *
 * @param document - Document updated in place.
 * @returns Number of branches given a length.
 */
export function assignPixelLengths(document: ExtractionDocument): number
{
    const nodeById = new Map<string, TreeNode>();

    for (const node of document.nodes)
    {
        nodeById.set(node.id, node);
    }

    let assigned = 0;

    for (const node of document.nodes)
    {
        const parent = node.parent === null ? null : nodeById.get(node.parent);

        if (parent !== undefined && parent !== null)
        {
            node.length = Math.max(0, Math.round(node.x - parent.x));
            assigned++;
        }
    }

    for (const tip of document.tips)
    {
        const parent = tip.parent === null ? null : nodeById.get(tip.parent);

        if (parent !== undefined && parent !== null)
        {
            // The branch ends where it was drawn, not where a marker it ran into carried the tip.
            tip.length = Math.max(0, Math.round((tip.extendedFrom ?? tip.x) - parent.x));
            assigned++;
        }
    }

    return assigned;
}
