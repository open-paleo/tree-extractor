/**
 * A clean drawing of the traced tree. The figure went in as it was printed: on its side, with
 * silhouettes, colored bands and a time axis, at whatever resolution the journal kept. The
 * tree comes out here redrawn from the document alone, root on the left and tips evenly spaced,
 * with branch lengths from the ages when the figure had a readable time axis and every tip at
 * the same depth otherwise. Beside the figure it is also the quickest check on the trace.
 */

import type { ExtractionDocument, Tip, TreeNode } from "./types.ts";
import { getTipDisplayName } from "./newick.ts";

/**
 * How the drawing is sized and lettered.
 */
export type RenderOptions = {
    /**
     * Use the ages for branch lengths when every node and tip in the tree has one; otherwise
     * every tip sits at the same depth.
     */
    branchLengths: boolean;

    /**
     * Vertical distance between neighboring tips, in pixels.
     */
    rowHeight: number;

    /**
     * Width of the tree from root to tip line, in pixels.
     */
    treeWidth: number;

    /**
     * Label font size in pixels.
     */
    fontSize: number;

    /**
     * Write node labels (support values) at the junctions.
     */
    nodeLabels: boolean;
};

/**
 * Options used when none are given.
 */
export const defaultRenderOptions: RenderOptions = {
    branchLengths: true,
    rowHeight: 18,
    treeWidth: 320,
    fontSize: 12,
    nodeLabels: true,
};

/**
 * A node or tip with its place in the drawing.
 */
type Placed = {
    /**
     * Node or tip identifier.
     */
    id: string;

    /**
     * Horizontal position of the branch end.
     */
    x: number;

    /**
     * Row center.
     */
    y: number;

    /**
     * Horizontal position of the parent's junction, or null at the root.
     */
    parentX: number | null;

    /**
     * Label text: the tip's name, or the node's support value.
     */
    label: string | null;

    /**
     * True for a tip.
     */
    isTip: boolean;

    /**
     * Rows of a node's first and last child, for its vertical connector.
     */
    span: [number, number];
};

/**
 * The tree's members by identifier, and the figure order of children.
 */
type TreeIndex = {
    /**
     * Nodes by identifier.
     */
    nodes: Map<string, TreeNode>;

    /**
     * Tips by identifier.
     */
    tips: Map<string, Tip>;
};

/**
 * The laid-out tree.
 */
type TreeLayout = {
    /**
     * Every member of the tree with its place.
     */
    placed: Array<Placed>;

    /**
     * Oldest and youngest age when ages set the depths, or null in the stepped layout.
     */
    ages: [number, number] | null;
};

/**
 * Indexes the document's nodes and tips.
 *
 * @param document - Document.
 * @returns The index.
 */
function indexTree(document: ExtractionDocument): TreeIndex
{
    const nodes = new Map<string, TreeNode>();
    const tips = new Map<string, Tip>();

    for (const node of document.nodes)
    {
        nodes.set(node.id, node);
    }

    for (const tip of document.tips)
    {
        tips.set(tip.id, tip);
    }

    return { nodes, tips };
}

/**
 * Vertical position of a member on the figure, for keeping the figure's tip order.
 *
 * @param index - Tree index.
 * @param id - Member identifier.
 * @returns Its row on the figure, or infinity for an unknown identifier.
 */
function measureFigureRow(index: TreeIndex, id: string): number
{
    const node = index.nodes.get(id);

    if (node !== undefined)
    {
        return node.attachY ?? (node.y0 + node.y1) / 2;
    }

    const tip = index.tips.get(id);

    return tip === undefined ? Infinity : tip.y;
}

/**
 * Children of a node in figure order, top to bottom, leaving out identifiers the document
 * does not have.
 *
 * @param index - Tree index.
 * @param node - Parent node.
 * @returns Child identifiers.
 */
function listChildrenInOrder(index: TreeIndex, node: TreeNode): Array<string>
{
    const children = new Array<string>();

    for (const child of node.children)
    {
        if (index.nodes.has(child) || index.tips.has(child))
        {
            children.push(child);
        }
    }

    function compareRows(left: string, right: string): number
    {
        return measureFigureRow(index, left) - measureFigureRow(index, right);
    }

    children.sort(compareRows);

    return children;
}

/**
 * Whether every member of the tree under the root has an age, so that ages can set the
 * branch lengths.
 *
 * @param index - Tree index.
 * @param root - Root identifier.
 * @returns True when ages are complete.
 */
function hasCompleteAges(index: TreeIndex, root: string): boolean
{
    const pending = [root];

    while (pending.length > 0)
    {
        const id = pending.pop() as string;
        const node = index.nodes.get(id);

        if (node !== undefined)
        {
            if (node.age === null)
            {
                return false;
            }

            for (const child of listChildrenInOrder(index, node))
            {
                pending.push(child);
            }
        }
        else
        {
            const tip = index.tips.get(id);

            if (tip === undefined || tip.age === null)
            {
                return false;
            }
        }
    }

    return true;
}

/**
 * Escapes text for SVG.
 *
 * @param text - Raw text.
 * @returns Escaped text.
 */
function escapeXml(text: string): string
{
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Lays the tree out: tips on evenly spaced rows in figure order, each node centered on its
 * children, depth from the ages when they are complete and wanted, otherwise one step per
 * level from the tips inward so that every tip ends on the tip line.
 *
 * @param document - Document with a tree.
 * @param options - Drawing options.
 * @returns The placed members, and the extent of the ages when they were used.
 */
function layOutTree(document: ExtractionDocument, options: RenderOptions): TreeLayout
{
    const index = indexTree(document);
    const root = document.root as string;
    const useAges = options.branchLengths && hasCompleteAges(index, root);
    const placed = new Array<Placed>();
    let nextRow = 0;
    let oldest = -Infinity;
    let youngest = Infinity;

    // First pass: rows, and the depth of each node measured from its deepest tip (in steps),
    // or its age.
    const rowOf = new Map<string, number>();
    const spanOf = new Map<string, [number, number]>();
    const levelOf = new Map<string, number>();

    function visit(id: string): number
    {
        const node = index.nodes.get(id);

        if (node === undefined)
        {
            const row = nextRow++;
            rowOf.set(id, row);
            spanOf.set(id, [row, row]);
            levelOf.set(id, 0);
            const tip = index.tips.get(id);

            if (useAges && tip !== undefined && tip.age !== null)
            {
                oldest = Math.max(oldest, tip.age);
                youngest = Math.min(youngest, tip.age);
            }

            return 0;
        }

        const children = listChildrenInOrder(index, node);

        if (children.length === 0)
        {
            const row = nextRow++;
            rowOf.set(id, row);
            spanOf.set(id, [row, row]);
            levelOf.set(id, 0);

            return 0;
        }

        let deepest = 0;
        let first = Infinity;
        let last = -Infinity;

        for (const child of children)
        {
            deepest = Math.max(deepest, visit(child) + 1);
            const row = rowOf.get(child) as number;
            first = Math.min(first, row);
            last = Math.max(last, row);
        }

        rowOf.set(id, (first + last) / 2);
        spanOf.set(id, [first, last]);
        levelOf.set(id, deepest);

        if (useAges && node.age !== null)
        {
            oldest = Math.max(oldest, node.age);
        }

        return deepest;
    }

    const rootLevel = visit(root);
    // Room on the left for the root's stub.
    const margin = 2.5 * options.fontSize;

    function placeX(id: string): number
    {
        if (useAges)
        {
            const member = index.nodes.get(id) ?? index.tips.get(id);
            const age = member === undefined || member.age === null ? youngest : member.age;
            const range = Math.max(1e-9, oldest - youngest);

            return margin + ((oldest - age) / range) * options.treeWidth;
        }

        const level = levelOf.get(id) ?? 0;
        const steps = Math.max(1, rootLevel);

        return margin + ((steps - level) / steps) * options.treeWidth;
    }

    // Second pass: positions. A tip under a shallower node still ends on the tip line in the
    // stepped layout, because its level is zero.
    function place(id: string, parentX: number | null): void
    {
        const node = index.nodes.get(id);
        const x = placeX(id);
        const y = margin + (rowOf.get(id) ?? 0) * options.rowHeight + options.rowHeight / 2;

        if (node === undefined)
        {
            placed.push({ id, x, y, parentX, label: getTipDisplayName(document, id), isTip: true, span: spanOf.get(id) ?? [0, 0] });

            return;
        }

        placed.push({ id, x, y, parentX, label: options.nodeLabels ? node.label : null, isTip: false, span: spanOf.get(id) ?? [0, 0] });

        for (const child of listChildrenInOrder(index, node))
        {
            place(child, x);
        }
    }

    place(root, null);

    return { placed, ages: useAges && Number.isFinite(oldest) && Number.isFinite(youngest) ? [oldest, youngest] : null };
}

/**
 * A round step for axis ticks: 1, 2, 5 or 10 times a power of ten, giving about five ticks.
 *
 * @param range - Span of the axis in its units.
 * @returns The step.
 */
function chooseTickStep(range: number): number
{
    const rough = range / 5;
    const power = 10 ** Math.floor(Math.log10(Math.max(1e-9, rough)));
    const candidates = [1, 2, 5, 10];
    let best = 10 * power;

    for (const candidate of candidates)
    {
        if (candidate * power >= rough)
        {
            best = candidate * power;
            break;
        }
    }

    return best;
}

/**
 * Draws the traced tree as an SVG document.
 *
 * @param document - Document with a tree.
 * @param options - Drawing options; missing fields take the defaults.
 * @returns SVG markup, or null when the document has no tree.
 */
export function renderTreeSvg(document: ExtractionDocument, options: Partial<RenderOptions> = {}): string | null
{
    if (document.root === null)
    {
        return null;
    }

    const settings: RenderOptions = { ...defaultRenderOptions, ...options };
    const { placed, ages } = layOutTree(document, settings);
    const fontSize = settings.fontSize;
    const margin = 2.5 * fontSize;
    let tipLineX = 0;
    let longestLabel = 0;
    let rows = 0;

    for (const member of placed)
    {
        tipLineX = Math.max(tipLineX, member.x);

        if (member.isTip)
        {
            rows++;
            longestLabel = Math.max(longestLabel, member.label === null ? 0 : member.label.length);
        }
    }

    const labelGap = 0.5 * fontSize;
    const labelWidth = Math.ceil(0.56 * fontSize * longestLabel);
    const axisHeight = ages === null ? 0 : 2.5 * fontSize;
    const width = Math.ceil(tipLineX + labelGap + labelWidth + margin);
    const height = Math.ceil(margin + rows * settings.rowHeight + fontSize + axisHeight);
    const parts = new Array<string>();
    const strokeWidth = Math.max(1, Math.round(fontSize / 8));
    const byId = new Map<string, Placed>();

    for (const member of placed)
    {
        byId.set(member.id, member);
    }

    parts.push(`<rect width="${width}" height="${height}" fill="white"/>`);
    parts.push(`<g fill="none" stroke="black" stroke-width="${strokeWidth}" stroke-linecap="square">`);

    for (const member of placed)
    {
        // The branch from the parent's junction to this member's end.
        if (member.parentX !== null)
        {
            parts.push(`<path d="M${member.parentX.toFixed(1)} ${member.y.toFixed(1)}H${member.x.toFixed(1)}"/>`);
        }
        else
        {
            parts.push(`<path d="M${(member.x - 1.5 * fontSize).toFixed(1)} ${member.y.toFixed(1)}H${member.x.toFixed(1)}"/>`);
        }

        // The vertical connector across the children's rows.
        if (!member.isTip && member.span[1] > member.span[0])
        {
            const top = margin + member.span[0] * settings.rowHeight + settings.rowHeight / 2;
            const bottom = margin + member.span[1] * settings.rowHeight + settings.rowHeight / 2;
            parts.push(`<path d="M${member.x.toFixed(1)} ${top.toFixed(1)}V${bottom.toFixed(1)}"/>`);
        }
    }

    parts.push("</g>");
    parts.push(`<g font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" fill="black">`);

    for (const member of placed)
    {
        if (member.label === null || member.label === "")
        {
            continue;
        }

        if (member.isTip)
        {
            const tipX = ages === null ? tipLineX : member.x;
            parts.push(`<text x="${(tipX + labelGap).toFixed(1)}" y="${member.y.toFixed(1)}" dominant-baseline="middle" font-style="italic">${escapeXml(member.label)}</text>`);
        }
        else
        {
            parts.push(`<text x="${(member.x + 0.3 * fontSize).toFixed(1)}" y="${(member.y - 0.3 * fontSize).toFixed(1)}" font-size="${Math.round(0.75 * fontSize)}" fill="#555">${escapeXml(member.label)}</text>`);
        }
    }

    parts.push("</g>");

    if (ages !== null)
    {
        const [oldest, youngest] = ages;
        const range = Math.max(1e-9, oldest - youngest);
        const axisY = height - 2 * fontSize;
        const step = chooseTickStep(range);
        const first = Math.ceil(youngest / step) * step;
        parts.push(`<g stroke="black" stroke-width="1" fill="black" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(0.8 * fontSize)}">`);
        parts.push(`<path d="M${margin.toFixed(1)} ${axisY.toFixed(1)}H${(margin + settings.treeWidth).toFixed(1)}"/>`);

        for (let value = first; value <= oldest + 1e-9; value += step)
        {
            const x = margin + ((oldest - value) / range) * settings.treeWidth;
            parts.push(`<path d="M${x.toFixed(1)} ${axisY.toFixed(1)}v4"/>`);
            parts.push(`<text x="${x.toFixed(1)}" y="${(axisY + fontSize + 2).toFixed(1)}" text-anchor="middle" stroke="none">${Number(value.toFixed(6))}</text>`);
        }

        parts.push("</g>");
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
}
