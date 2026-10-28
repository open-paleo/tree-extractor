/**
 * Lookups into an extraction document that the viewer needs: connectivity, elements by id,
 * marker positions and hit testing.
 */

import type { ExtractionDocument, TreeNode } from "../core/types.ts";
import { collectConnected } from "../core/tree.ts";
import type { Layers, Selection } from "./state.ts";
import { mapPointToFrame } from "../core/geometry.ts";

export { collectConnected };

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
 * Finds the tip or node whose label text box contains a point.
 *
 * @param document - Document to search.
 * @param imageX - Image x.
 * @param imageY - Image y.
 * @returns The label's owner, or null.
 */
function findLabelOwner(document: ExtractionDocument, imageX: number, imageY: number): Selection | null
{
    let lineId: string | null = null;

    for (const line of document.textLines)
    {
        const point = line.frame === undefined ? { x: imageX, y: imageY } : mapPointToFrame(line.frame, imageX, imageY);

        if (point.x >= line.box.x0 && point.x < line.box.x1 && point.y >= line.box.y0 && point.y < line.box.y1)
        {
            lineId = line.id;
            break;
        }
    }

    if (lineId === null)
    {
        return null;
    }

    for (const tip of document.tips)
    {
        if (tip.textLine === lineId)
        {
            return { kind: "tip", id: tip.id };
        }
    }

    for (const node of document.nodes)
    {
        if (node.textLine === lineId)
        {
            return { kind: "node", id: node.id };
        }
    }

    return null;
}

/**
 * Finds what an image point selects: the tip or node whose label text it lies on, else the
 * nearest marker within a radius.
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
    const labelOwner = findLabelOwner(document, imageX, imageY);

    if (labelOwner !== null)
    {
        return labelOwner;
    }

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
