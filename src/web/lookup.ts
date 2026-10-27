/**
 * Lookups into an extraction document that the viewer needs: connectivity, elements by id,
 * marker positions and hit testing.
 */

import type { ExtractionDocument, Tip, TreeNode } from "../core/types.ts";
import type { Layers, Selection } from "./state.ts";

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
 * Finds a tip by identifier.
 *
 * @param document - Document to search.
 * @param id - Tip identifier.
 * @returns The tip, or null.
 */
export function findTip(document: ExtractionDocument, id: string): Tip | null
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
export function findNode(document: ExtractionDocument, id: string): TreeNode | null
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
 * Where a node is drawn: at the junction with its parent, or mid-span at the root.
 *
 * @param node - The node.
 * @returns Image y.
 */
export function getNodeMarkerY(node: TreeNode): number
{
    return node.attachY ?? (node.y0 + node.y1) / 2;
}

/**
 * Finds the tip or node nearest to an image point, within a radius.
 *
 * @param document - Document to search.
 * @param layers - Only visible layers are hit.
 * @param imageX - Image x.
 * @param imageY - Image y.
 * @param radius - Largest distance in image pixels.
 * @returns The nearest element, or null.
 */
export function hitTest(document: ExtractionDocument, layers: Layers, imageX: number, imageY: number, radius: number): Selection | null
{
    let best: Selection | null = null;
    let bestDistance = radius;

    if (layers.tips)
    {
        for (const tip of document.tips)
        {
            const distance = Math.hypot(tip.x - imageX, tip.y - imageY);

            if (distance <= bestDistance)
            {
                best = { kind: "tip", id: tip.id };
                bestDistance = distance;
            }
        }
    }

    if (layers.nodes)
    {
        for (const node of document.nodes)
        {
            const distance = Math.hypot(node.x - imageX, getNodeMarkerY(node) - imageY);

            if (distance <= bestDistance)
            {
                best = { kind: "node", id: node.id };
                bestDistance = distance;
            }
        }
    }

    return best;
}
