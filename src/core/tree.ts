/**
 * Traversal helpers over the tree part of an extraction document.
 */

import type { ExtractionDocument, TreeNode } from "./types.ts";

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
 * @returns True when the root changed.
 */
export function chooseRoot(document: ExtractionDocument): boolean
{
    let best: string | null = null;
    let bestSize = 0;

    for (const node of document.nodes)
    {
        if (node.parent !== null)
        {
            continue;
        }

        const size = countTipsUnder(document, node.id);

        if (size > bestSize)
        {
            best = node.id;
            bestSize = size;
        }
    }

    if (best === null || best === document.root)
    {
        return false;
    }

    document.root = best;

    return true;
}
