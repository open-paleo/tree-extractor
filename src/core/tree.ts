/**
 * Traversal helpers over the tree part of an extraction document.
 */

import type { ExtractionDocument, Tip, TreeNode } from "./types.ts";

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
    for (const node of document.nodes)
    {
        if (node.parent !== null)
        {
            continue;
        }

        const size = countTipsUnder(document, node.id);
        const named = byNames ? countNamedTipsUnder(document, node.id) : 0;

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
