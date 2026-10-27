/**
 * Image decoding and overlay rendering for Node, via sharp.
 */

import sharp from "sharp";

import type { ExtractionDocument, RgbaImage } from "../core/types.ts";
import { getTipDisplayName } from "../core/newick.ts";

/**
 * Decodes an image file to RGBA.
 *
 * @param filePath - Path to a PNG, JPEG, TIFF or WebP file.
 * @returns The decoded image.
 */
export async function loadImage(filePath: string): Promise<RgbaImage>
{
    const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) };
}

/**
 * Escapes text for inclusion in SVG.
 *
 * @param text - Raw text.
 * @returns Escaped text.
 */
function escapeXml(text: string): string
{
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Builds an SVG layer showing what the pipeline found.
 *
 * @param document - Extraction document.
 * @returns SVG markup sized to the image.
 */
export function renderOverlaySvg(document: ExtractionDocument): string
{
    const parts = new Array<string>();
    const nodeIds = new Set<string>();

    for (const node of document.nodes)
    {
        nodeIds.add(node.id);
    }

    for (const segment of document.horizontals)
    {
        const { x0, y0, x1, y1 } = segment.box;
        parts.push(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="rgba(0,120,255,0.35)"/>`);
    }

    for (const segment of document.verticals)
    {
        const { x0, y0, x1, y1 } = segment.box;
        parts.push(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="rgba(255,140,0,0.35)"/>`);
    }

    for (const line of document.textLines)
    {
        const color = line.role === "tip" ? "rgba(0,170,0,0.9)" : line.role === "node" ? "rgba(160,0,200,0.9)" : "rgba(160,160,160,0.6)";
        const { x0, y0, x1, y1 } = line.box;
        parts.push(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="${color}" stroke-width="1"/>`);
    }

    for (const node of document.nodes)
    {
        const inTree = node.parent !== null || node.id === document.root;
        const color = inTree ? "rgba(255,80,0,0.95)" : "rgba(255,0,0,0.6)";
        parts.push(`<circle cx="${node.x}" cy="${node.attachY ?? (node.y0 + node.y1) / 2}" r="4" fill="${color}"/>`);
        const text = node.label === null ? node.id : `${node.id}:${node.label}`;
        parts.push(`<text x="${node.x + 5}" y="${(node.attachY ?? node.y0) - 3}" font-size="9" fill="${color}">${escapeXml(text)}</text>`);
    }

    for (const tip of document.tips)
    {
        const color = tip.parent !== null && nodeIds.has(tip.parent) ? "rgba(0,160,0,0.95)" : "rgba(255,0,0,0.9)";
        parts.push(`<circle cx="${tip.x}" cy="${tip.y}" r="3" fill="${color}"/>`);
        const name = getTipDisplayName(document, tip.id);
        parts.push(`<text x="${tip.x + 4}" y="${tip.y + 12}" font-size="8" fill="${color}">${escapeXml(`${tip.id} ${name}`)}</text>`);
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${document.image.width}" height="${document.image.height}">${parts.join("")}</svg>`;
}

/**
 * Writes the source image with the overlay composited on top.
 *
 * @param imagePath - Source image path.
 * @param document - Extraction document.
 * @param outputPath - Destination PNG path.
 * @returns Resolves when written.
 */
export async function writeOverlay(imagePath: string, document: ExtractionDocument, outputPath: string): Promise<void>
{
    await sharp(imagePath)
        .composite([{ input: Buffer.from(renderOverlaySvg(document)) }])
        .png()
        .toFile(outputPath);
}
