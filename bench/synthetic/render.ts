/**
 * Lays out a synthetic tree as a rectangular figure and renders it through SVG to a raster,
 * with the decorations and degradations real figures have.
 */

import sharp from "sharp";

import type { SeededRandom } from "./random.ts";
import type { SyntheticNode } from "./tree.ts";

/**
 * Everything that varies between figure styles.
 */
export type FigureStyle = {
    /**
     * Pixels between neighboring tip rows.
     */
    rowSpacing: number;

    /**
     * Font size in pixels.
     */
    fontSize: number;

    /**
     * Font family for labels.
     */
    fontFamily: string;

    /**
     * Whether tip labels are italic.
     */
    italic: boolean;

    /**
     * Whether tip labels are bold.
     */
    bold: boolean;

    /**
     * Line width in pixels.
     */
    lineWidth: number;

    /**
     * Cladogram (tips aligned) or phylogram (branch lengths drawn).
     */
    layout: "cladogram" | "phylogram";

    /**
     * Where support values are printed.
     */
    supportPlacement: "none" | "above-junction" | "on-branch-boxed";

    /**
     * Chance that a tip gets a thick range bar near its end.
     */
    rangeBarRate: number;

    /**
     * Whether light vertical bands cross the figure.
     */
    bands: boolean;

    /**
     * How many colored boxes are drawn behind subtrees.
     */
    cladeBoxes: number;

    /**
     * Gap between a tip's branch end and its label, in pixels; negative lets them touch.
     */
    labelGap: number;

    /**
     * JPEG quality to encode at, or 0 to keep a lossless PNG.
     */
    jpegQuality: number;

    /**
     * Factor by which the raster is shrunk and then re-enlarged, or 1 for none.
     */
    blurFactor: number;
};

/**
 * A node with its position on the figure.
 */
type PlacedNode = {
    /**
     * The tree node.
     */
    node: SyntheticNode;

    /**
     * Vertical position (tip row, or mean of children).
     */
    x: number;

    /**
     * Horizontal position of the node's vertical, or of the tip's branch end.
     */
    y: number;

    /**
     * Placed children.
     */
    children: Array<PlacedNode>;
};

/**
 * Result of rendering.
 */
export type RenderedFigure = {
    /**
     * Encoded image bytes.
     */
    bytes: Buffer;

    /**
     * File extension matching the encoding.
     */
    extension: "png" | "jpg";

    /**
     * Figure width in pixels.
     */
    width: number;

    /**
     * Figure height in pixels.
     */
    height: number;
};

const leftMargin = 60;
const topMargin = 40;
const labelAllowance = 260;

/**
 * Assigns rows to tips and positions to nodes.
 *
 * @param node - Subtree root.
 * @param depth - Depth of the node, for cladogram x.
 * @param distance - Summed branch length, for phylogram x.
 * @param rowCounter - Next free tip row, shared by reference.
 * @param style - Figure style.
 * @param maxDepth - Deepest tip depth, for cladogram spacing.
 * @param maxDistance - Largest summed branch length, for phylogram scaling.
 * @param width - Width available for the tree proper.
 * @returns The placed subtree.
 */
function place(
    node: SyntheticNode,
    depth: number,
    distance: number,
    rowCounter: Array<number>,
    style: FigureStyle,
    maxDepth: number,
    maxDistance: number,
    width: number,
): PlacedNode
{
    const children = new Array<PlacedNode>();

    for (const child of node.children)
    {
        children.push(place(child, depth + 1, distance + child.length, rowCounter, style, maxDepth, maxDistance, width));
    }

    let y: number;

    if (children.length === 0)
    {
        y = topMargin + rowCounter[0] * style.rowSpacing;
        rowCounter[0]++;
    }
    else
    {
        y = (children[0].y + children[children.length - 1].y) / 2;
    }

    let x: number;

    if (style.layout === "cladogram")
    {
        x = children.length === 0 ? leftMargin + width : leftMargin + (depth / maxDepth) * width;
    }
    else
    {
        x = leftMargin + (distance / maxDistance) * width;
    }

    return { node, x, y, children };
}

/**
 * Deepest tip depth.
 *
 * @param node - Subtree root.
 * @param depth - Depth of the node.
 * @returns Largest depth below.
 */
function measureDepth(node: SyntheticNode, depth: number): number
{
    let deepest = depth;

    for (const child of node.children)
    {
        deepest = Math.max(deepest, measureDepth(child, depth + 1));
    }

    return deepest;
}

/**
 * Largest summed branch length to a tip.
 *
 * @param node - Subtree root.
 * @param distance - Summed length to the node.
 * @returns Largest distance below.
 */
function measureDistance(node: SyntheticNode, distance: number): number
{
    let farthest = distance;

    for (const child of node.children)
    {
        farthest = Math.max(farthest, measureDistance(child, distance + child.length));
    }

    return farthest;
}

/**
 * Counts tips.
 *
 * @param node - Subtree root.
 * @returns Number of tips below.
 */
function countTips(node: SyntheticNode): number
{
    if (node.children.length === 0)
    {
        return 1;
    }

    let total = 0;

    for (const child of node.children)
    {
        total += countTips(child);
    }

    return total;
}

/**
 * Escapes text for SVG.
 *
 * @param text - Raw text.
 * @returns Escaped text.
 */
function escapeXml(text: string): string
{
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Collects internal nodes with their subtree extents, for clade boxes.
 *
 * @param placed - Placed subtree.
 * @param out - Receives internal nodes.
 */
function collectInternal(placed: PlacedNode, out: Array<PlacedNode>): void
{
    if (placed.children.length > 0)
    {
        out.push(placed);
    }

    for (const child of placed.children)
    {
        collectInternal(child, out);
    }
}

/**
 * Lowest and highest tip rows below a node.
 *
 * @param placed - Placed subtree.
 * @returns Top and bottom y.
 */
function measureExtent(placed: PlacedNode): Array<number>
{
    if (placed.children.length === 0)
    {
        return [placed.y, placed.y];
    }

    let top = Infinity;
    let bottom = -Infinity;

    for (const child of placed.children)
    {
        const [childTop, childBottom] = measureExtent(child);
        top = Math.min(top, childTop);
        bottom = Math.max(bottom, childBottom);
    }

    return [top, bottom];
}

/**
 * Emits the SVG for branches, nodes, labels and decorations.
 *
 * @param placed - Placed subtree.
 * @param style - Figure style.
 * @param random - Random source for decorations.
 * @param parts - Receives SVG fragments.
 */
function emitTree(placed: PlacedNode, style: FigureStyle, random: SeededRandom, parts: Array<string>): void
{
    const stroke = `stroke="black" stroke-width="${style.lineWidth}" stroke-linecap="butt"`;

    if (placed.children.length === 0)
    {
        if (random.chance(style.rangeBarRate))
        {
            const barLength = random.nextBetween(20, 60);
            parts.push(`<rect x="${(placed.x - barLength).toFixed(1)}" y="${(placed.y - style.lineWidth * 1.5).toFixed(1)}" width="${barLength.toFixed(1)}" height="${(style.lineWidth * 3).toFixed(1)}" fill="black"/>`);
        }

        const weight = style.bold ? "bold" : "normal";
        const fontStyle = style.italic ? "italic" : "normal";
        parts.push(`<text x="${(placed.x + style.labelGap).toFixed(1)}" y="${(placed.y + style.fontSize * 0.35).toFixed(1)}" font-family="${style.fontFamily}" font-size="${style.fontSize}" font-style="${fontStyle}" font-weight="${weight}">${escapeXml(placed.node.name ?? "")}</text>`);

        return;
    }

    const first = placed.children[0];
    const last = placed.children[placed.children.length - 1];
    parts.push(`<line x1="${placed.x.toFixed(1)}" y1="${first.y.toFixed(1)}" x2="${placed.x.toFixed(1)}" y2="${last.y.toFixed(1)}" ${stroke}/>`);

    for (const child of placed.children)
    {
        parts.push(`<line x1="${placed.x.toFixed(1)}" y1="${child.y.toFixed(1)}" x2="${child.x.toFixed(1)}" y2="${child.y.toFixed(1)}" ${stroke}/>`);
        emitTree(child, style, random, parts);
    }

    if (placed.node.support !== null && style.supportPlacement !== "none")
    {
        const size = Math.max(8, style.fontSize - 2);
        const text = escapeXml(placed.node.support);
        const textWidth = text.length * size * 0.6;

        if (style.supportPlacement === "above-junction")
        {
            parts.push(`<text x="${(placed.x - textWidth - 3).toFixed(1)}" y="${(placed.y - 3).toFixed(1)}" font-family="${style.fontFamily}" font-size="${size}">${text}</text>`);
        }
        else
        {
            const boxX = placed.x - textWidth - 6;
            const boxY = placed.y - size * 0.7;
            parts.push(`<rect x="${boxX.toFixed(1)}" y="${boxY.toFixed(1)}" width="${(textWidth + 4).toFixed(1)}" height="${(size * 1.2).toFixed(1)}" fill="white"/>`);
            parts.push(`<text x="${(boxX + 2).toFixed(1)}" y="${(placed.y + size * 0.35).toFixed(1)}" font-family="${style.fontFamily}" font-size="${size}">${text}</text>`);
        }
    }
}

/**
 * Renders a tree to an image.
 *
 * @param root - Tree to draw.
 * @param style - Figure style.
 * @param random - Random source for decorations.
 * @returns Encoded image and its size.
 */
export async function renderFigure(root: SyntheticNode, style: FigureStyle, random: SeededRandom): Promise<RenderedFigure>
{
    const tipCount = countTips(root);
    const treeWidth = Math.round(400 + tipCount * 8);
    const width = leftMargin + treeWidth + labelAllowance + Math.round(style.fontSize * 10);
    const height = topMargin * 2 + tipCount * style.rowSpacing;
    const rows = [0];
    const placed = place(root, 0, 0, rows, style, Math.max(1, measureDepth(root, 0)), Math.max(1, measureDistance(root, 0)), treeWidth);
    const parts = new Array<string>();
    parts.push(`<rect width="${width}" height="${height}" fill="white"/>`);

    if (style.bands)
    {
        for (let x = leftMargin; x < width; x += random.nextInt(40, 90))
        {
            const bandWidth = random.nextInt(20, 50);
            const shade = random.pick(["#f0f0f0", "#e8eef6", "#f3efe4", "#eaf4ea"]);
            parts.push(`<rect x="${x}" y="0" width="${bandWidth}" height="${height}" fill="${shade}"/>`);
        }
    }

    if (style.cladeBoxes > 0)
    {
        const internal = new Array<PlacedNode>();
        collectInternal(placed, internal);

        for (let index = 0; index < style.cladeBoxes && internal.length > 0; index++)
        {
            const chosen = random.pick(internal);
            const [top, bottom] = measureExtent(chosen);
            const fill = random.pick(["#c8f0d8", "#ffe6c8", "#d8e4ff", "#f6d8f0"]);
            parts.push(`<rect x="${(chosen.x - 10).toFixed(1)}" y="${(top - style.rowSpacing / 2).toFixed(1)}" width="${(width - chosen.x - 20).toFixed(1)}" height="${(bottom - top + style.rowSpacing).toFixed(1)}" fill="${fill}" stroke="#d04040" stroke-width="2"/>`);
        }
    }

    // Root stub.
    parts.push(`<line x1="${(leftMargin - 30).toFixed(1)}" y1="${placed.y.toFixed(1)}" x2="${placed.x.toFixed(1)}" y2="${placed.y.toFixed(1)}" stroke="black" stroke-width="${style.lineWidth}"/>`);
    emitTree(placed, style, random, parts);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join("")}</svg>`;
    let pipeline = sharp(Buffer.from(svg)).flatten({ background: "#ffffff" });

    if (style.blurFactor > 1)
    {
        const small = await pipeline.resize({ width: Math.round(width / style.blurFactor) }).png().toBuffer();
        pipeline = sharp(small).resize({ width });
    }

    if (style.jpegQuality > 0)
    {
        return { bytes: await pipeline.jpeg({ quality: style.jpegQuality }).toBuffer(), extension: "jpg", width, height };
    }

    return { bytes: await pipeline.png().toBuffer(), extension: "png", width, height };
}
