/**
 * Decorations: pieces the trace built out of things that are not the tree. Clade brackets to
 * the right of the labels, a time axis above the tree, a legend below it: each is a vertical
 * with a few horizontals, so each traces into a small disconnected subtree. They are recognized
 * by where they lie, never by what they look like, so a real subtree that lost its connection
 * to the tree is left alone: it sits inside the tree's extent, with its tips at the tip line.
 */

import type { Box, ExtractionDocument, QcIssue, Tip, TreeNode } from "./types.ts";
import { collectConnected } from "./tree.ts";

/**
 * A disconnected subtree with its extent.
 */
type Piece = {
    /**
     * Its root node.
     */
    root: TreeNode;

    /**
     * Node identifiers in it.
     */
    nodes: Array<string>;

    /**
     * Tips in it.
     */
    tips: Array<Tip>;

    /**
     * Extent of its nodes and tips.
     */
    box: Box;
};

/**
 * Collects the subtree under a node.
 *
 * @param document - Document.
 * @param root - Root of the piece.
 * @returns The piece.
 */
function collectPiece(document: ExtractionDocument, root: TreeNode): Piece
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

    const piece: Piece = { root, nodes: [], tips: [], box: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity } };

    function visit(id: string): void
    {
        const node = nodeById.get(id);

        if (node !== undefined)
        {
            piece.nodes.push(node.id);
            piece.box.x0 = Math.min(piece.box.x0, node.x);
            piece.box.x1 = Math.max(piece.box.x1, node.x);
            piece.box.y0 = Math.min(piece.box.y0, node.y0);
            piece.box.y1 = Math.max(piece.box.y1, node.y1);

            for (const child of node.children)
            {
                visit(child);
            }

            return;
        }

        const tip = tipById.get(id);

        if (tip !== undefined)
        {
            piece.tips.push(tip);
            piece.box.x0 = Math.min(piece.box.x0, tip.x);
            piece.box.x1 = Math.max(piece.box.x1, tip.x);
            piece.box.y0 = Math.min(piece.box.y0, tip.y);
            piece.box.y1 = Math.max(piece.box.y1, tip.y);
        }
    }

    visit(root.id);

    return piece;
}

/**
 * Extent of the main tree: its nodes and tips.
 *
 * @param document - Document.
 * @param connected - Identifiers in the main tree.
 * @returns The box, or null when there is no tree.
 */
function measureMainExtent(document: ExtractionDocument, connected: Set<string>): Box | null
{
    const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };

    for (const node of document.nodes)
    {
        if (connected.has(node.id))
        {
            box.x0 = Math.min(box.x0, node.x);
            box.x1 = Math.max(box.x1, node.x);
            box.y0 = Math.min(box.y0, node.y0);
            box.y1 = Math.max(box.y1, node.y1);
        }
    }

    for (const tip of document.tips)
    {
        if (connected.has(tip.id))
        {
            box.x0 = Math.min(box.x0, tip.x);
            box.x1 = Math.max(box.x1, tip.x);
            box.y0 = Math.min(box.y0, tip.y);
            box.y1 = Math.max(box.y1, tip.y);
        }
    }

    return Number.isFinite(box.x0) ? box : null;
}

/**
 * Why a piece counts as decoration, or null when it does not.
 *
 * @param piece - Disconnected subtree.
 * @param main - Extent of the main tree.
 * @param glyphHeight - Glyph height in pixels.
 * @returns A short reason, or null.
 */
function explainDecoration(piece: Piece, main: Box, glyphHeight: number): string | null
{
    if (piece.box.x0 > main.x1 + glyphHeight)
    {
        return "lies entirely to the right of the tips";
    }

    let labelled = false;

    for (const tip of piece.tips)
    {
        if (tip.textLine !== null)
        {
            labelled = true;
            break;
        }
    }

    if (!labelled && (piece.box.y1 < main.y0 - glyphHeight || piece.box.y0 > main.y1 + glyphHeight))
    {
        return piece.box.y1 < main.y0 ? "lies above the tree with no labels" : "lies below the tree with no labels";
    }

    return null;
}

/**
 * Removes disconnected subtrees that lie where decorations go: entirely right of the tips, or
 * above or below the tree with no labels. Their text rows become unassigned again.
 *
 * @param document - Document updated in place.
 * @returns One informational issue per piece removed.
 */
export function pruneDecorations(document: ExtractionDocument): Array<QcIssue>
{
    const issues = new Array<QcIssue>();
    const connected = collectConnected(document);
    const main = measureMainExtent(document, connected);

    if (main === null)
    {
        return issues;
    }

    const removedNodes = new Set<string>();
    const removedTips = new Set<string>();

    for (const node of document.nodes)
    {
        if (node.parent !== null || connected.has(node.id))
        {
            continue;
        }

        const piece = collectPiece(document, node);
        const reason = explainDecoration(piece, main, document.glyphHeight);

        if (reason === null)
        {
            continue;
        }

        for (const id of piece.nodes)
        {
            removedNodes.add(id);
        }

        for (const tip of piece.tips)
        {
            removedTips.add(tip.id);
        }

        issues.push({
            severity: "info",
            code: "decoration-dropped",
            message: `piece ${node.id} with ${piece.tips.length} tip(s) at x ${Math.round(piece.box.x0)}-${Math.round(piece.box.x1)}, y ${Math.round(piece.box.y0)}-${Math.round(piece.box.y1)} dropped: ${reason}`,
            subject: null,
        });
    }

    if (removedNodes.size === 0)
    {
        return issues;
    }

    const freedLines = new Set<string>();
    const nodes = new Array<TreeNode>();
    const tips = new Array<Tip>();

    for (const node of document.nodes)
    {
        if (removedNodes.has(node.id))
        {
            if (node.textLine !== null)
            {
                freedLines.add(node.textLine);
            }
        }
        else
        {
            nodes.push(node);
        }
    }

    for (const tip of document.tips)
    {
        if (removedTips.has(tip.id))
        {
            if (tip.textLine !== null)
            {
                freedLines.add(tip.textLine);
            }
        }
        else
        {
            tips.push(tip);
        }
    }

    for (const line of document.textLines)
    {
        if (freedLines.has(line.id))
        {
            line.role = "unassigned";
        }
    }

    document.nodes = nodes;
    document.tips = tips;

    return issues;
}
