/**
 * Image rendering: draws the figure and its overlays on a canvas under a zoom-and-pan transform.
 */

import type { ExtractionDocument, RotatedFrame } from "../core/types.ts";
import type { ViewTransform, ViewerState } from "./state.ts";
import { collectConnected, getNodeMarkerY } from "./lookup.ts";
import { findNodeById, findTipById } from "../core/edit.ts";

const minScale = 0.05;
const maxScale = 32;

/**
 * Applies a text row's level frame to the context, so that a box drawn in frame coordinates
 * lands turned on the figure. Without a frame nothing happens.
 *
 * @param context - Drawing context.
 * @param frame - The row's frame, if any.
 */
function enterFrame(context: CanvasRenderingContext2D, frame: RotatedFrame | undefined): void
{
    if (frame === undefined)
    {
        return;
    }

    context.save();
    context.translate(frame.sourceCenterX, frame.sourceCenterY);
    context.rotate(frame.angle);
    context.translate(-frame.centerX, -frame.centerY);
}

/**
 * Undoes enterFrame.
 *
 * @param context - Drawing context.
 * @param frame - The row's frame, if any.
 */
function leaveFrame(context: CanvasRenderingContext2D, frame: RotatedFrame | undefined): void
{
    if (frame !== undefined)
    {
        context.restore();
    }
}

/**
 * A canvas showing the figure with a view transform.
 */
export class CanvasView
{
    /**
     * Current mapping from image to screen pixels.
     */
    public readonly view: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };

    private readonly canvas: HTMLCanvasElement;

    /**
     * Wraps a canvas element.
     *
     * @param canvas - Canvas to draw on.
     */
    public constructor(canvas: HTMLCanvasElement)
    {
        this.canvas = canvas;
    }

    /**
     * Width of the canvas in CSS pixels.
     *
     * @returns Width.
     */
    public getWidth(): number
    {
        return this.canvas.clientWidth;
    }

    /**
     * Height of the canvas in CSS pixels.
     *
     * @returns Height.
     */
    public getHeight(): number
    {
        return this.canvas.clientHeight;
    }

    /**
     * Converts a screen x (relative to the canvas) to an image x.
     *
     * @param screenX - Screen coordinate.
     * @returns Image coordinate.
     */
    public toImageX(screenX: number): number
    {
        return (screenX - this.view.offsetX) / this.view.scale;
    }

    /**
     * Converts a screen y (relative to the canvas) to an image y.
     *
     * @param screenY - Screen coordinate.
     * @returns Image coordinate.
     */
    public toImageY(screenY: number): number
    {
        return (screenY - this.view.offsetY) / this.view.scale;
    }

    /**
     * Scales the view so the whole image fits, centered.
     *
     * @param state - Viewer state holding the image.
     */
    public fit(state: ViewerState): void
    {
        if (state.bitmap === null)
        {
            return;
        }

        const width = this.getWidth();
        const height = this.getHeight();
        this.view.scale = Math.max(minScale, Math.min(width / state.bitmap.width, height / state.bitmap.height));
        this.view.offsetX = (width - state.bitmap.width * this.view.scale) / 2;
        this.view.offsetY = (height - state.bitmap.height * this.view.scale) / 2;
        this.render(state);
    }

    /**
     * Zooms by a factor about a screen point, which stays fixed.
     *
     * @param state - Viewer state to redraw.
     * @param screenX - Anchor x relative to the canvas.
     * @param screenY - Anchor y relative to the canvas.
     * @param factor - Multiplier for the scale.
     */
    public zoomAt(state: ViewerState, screenX: number, screenY: number, factor: number): void
    {
        const imageX = this.toImageX(screenX);
        const imageY = this.toImageY(screenY);
        this.view.scale = Math.max(minScale, Math.min(maxScale, this.view.scale * factor));
        this.view.offsetX = screenX - imageX * this.view.scale;
        this.view.offsetY = screenY - imageY * this.view.scale;
        this.render(state);
    }

    /**
     * Pans by a screen-pixel delta from a starting offset.
     *
     * @param state - Viewer state to redraw.
     * @param offsetX - New horizontal offset.
     * @param offsetY - New vertical offset.
     */
    public panTo(state: ViewerState, offsetX: number, offsetY: number): void
    {
        this.view.offsetX = offsetX;
        this.view.offsetY = offsetY;
        this.render(state);
    }

    /**
     * Pans so that an image point is on screen, centering it when it was not.
     *
     * @param state - Viewer state to redraw.
     * @param imageX - Image x.
     * @param imageY - Image y.
     */
    public ensureVisible(state: ViewerState, imageX: number, imageY: number): void
    {
        const screenX = imageX * this.view.scale + this.view.offsetX;
        const screenY = imageY * this.view.scale + this.view.offsetY;
        const margin = 24;

        if (screenX < margin || screenX > this.getWidth() - margin || screenY < margin || screenY > this.getHeight() - margin)
        {
            this.panTo(state, this.getWidth() / 2 - imageX * this.view.scale, this.getHeight() / 2 - imageY * this.view.scale);
        }
    }

    /**
     * Matches the canvas backing store to its displayed size and redraws.
     *
     * @param state - Viewer state to redraw.
     */
    public resize(state: ViewerState): void
    {
        const ratio = window.devicePixelRatio || 1;
        const width = Math.round(this.canvas.clientWidth * ratio);
        const height = Math.round(this.canvas.clientHeight * ratio);

        if (this.canvas.width !== width || this.canvas.height !== height)
        {
            this.canvas.width = width;
            this.canvas.height = height;
        }

        this.render(state);
    }

    /**
     * Draws the image and every overlay for the current view.
     *
     * @param state - Viewer state to draw.
     */
    public render(state: ViewerState): void
    {
        const context = this.canvas.getContext("2d");

        if (context === null)
        {
            return;
        }

        const ratio = window.devicePixelRatio || 1;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if (state.bitmap === null)
        {
            return;
        }

        context.setTransform(ratio * this.view.scale, 0, 0, ratio * this.view.scale, ratio * this.view.offsetX, ratio * this.view.offsetY);
        context.imageSmoothingEnabled = this.view.scale < 1;
        context.drawImage(state.bitmap, 0, 0);
        const unit = 1 / this.view.scale;

        if (state.extraction !== null)
        {
            this.drawOverlays(context, state, state.extraction, unit);
        }

        this.drawRegion(context, state, unit);

        if (state.draftSpan !== null)
        {
            context.strokeStyle = "rgba(255, 80, 0, 0.95)";
            context.lineWidth = 3 * unit;
            context.beginPath();
            context.moveTo(state.draftSpan.x0, state.draftSpan.y0);
            context.lineTo(state.draftSpan.x0, state.draftSpan.y1);
            context.stroke();
        }
    }

    /**
     * Draws segments, text boxes, nodes, tips and the selection.
     *
     * @param context - Canvas context already transformed to image space.
     * @param state - Viewer state for layers and selection.
     * @param document - Document to draw.
     * @param unit - Length of one screen pixel in image pixels.
     */
    private drawOverlays(context: CanvasRenderingContext2D, state: ViewerState, document: ExtractionDocument, unit: number): void
    {
        const connected = collectConnected(document);
        context.font = `${10 * unit}px sans-serif`;

        if (state.layers.segments)
        {
            context.fillStyle = "rgba(0, 120, 255, 0.35)";

            for (const segment of document.horizontals)
            {
                const { x0, y0, x1, y1 } = segment.box;
                context.fillRect(x0, y0, x1 - x0, y1 - y0);
            }

            context.fillStyle = "rgba(255, 140, 0, 0.35)";

            for (const segment of document.verticals)
            {
                const { x0, y0, x1, y1 } = segment.box;
                context.fillRect(x0, y0, x1 - x0, y1 - y0);
            }
        }

        if (state.layers.text)
        {
            context.lineWidth = unit;

            for (const line of document.textLines)
            {
                context.strokeStyle = line.role === "tip" ? "rgba(0, 170, 0, 0.9)" : line.role === "node" ? "rgba(160, 0, 200, 0.9)" : "rgba(160, 160, 160, 0.6)";
                const { x0, y0, x1, y1 } = line.box;
                enterFrame(context, line.frame);
                context.strokeRect(x0, y0, x1 - x0, y1 - y0);
                leaveFrame(context, line.frame);
            }
        }

        if (state.layers.nodes)
        {
            for (const node of document.nodes)
            {
                context.fillStyle = connected.has(node.id) ? "rgba(255, 80, 0, 0.95)" : "rgba(255, 0, 0, 0.6)";
                const y = getNodeMarkerY(node);
                context.beginPath();
                context.arc(node.x, y, 4 * unit, 0, Math.PI * 2);
                context.fill();

                if (node.label !== null)
                {
                    context.fillText(node.label, node.x + 6 * unit, y - 4 * unit);
                }
            }
        }

        if (state.layers.tips)
        {
            for (const tip of document.tips)
            {
                context.fillStyle = connected.has(tip.id) ? "rgba(0, 160, 0, 0.95)" : "rgba(255, 0, 0, 0.9)";
                context.beginPath();
                context.arc(tip.x, tip.y, 3 * unit, 0, Math.PI * 2);
                context.fill();
                context.fillText(tip.id, tip.x + 4 * unit, tip.y + 12 * unit);
            }
        }

        if (state.selection !== null)
        {
            this.drawSelection(context, state, document, unit);
        }
    }

    /**
     * Draws a ring around the selected tip or node and outlines its text line.
     *
     * @param context - Canvas context in image space.
     * @param state - Viewer state holding the selection.
     * @param document - Document.
     * @param unit - Length of one screen pixel in image pixels.
     */
    private drawSelection(context: CanvasRenderingContext2D, state: ViewerState, document: ExtractionDocument, unit: number): void
    {
        if (state.selection === null)
        {
            return;
        }

        let x = 0;
        let y = 0;
        let textLine: string | null = null;

        if (state.selection.kind === "tip")
        {
            const tip = findTipById(document, state.selection.id);

            if (tip === null)
            {
                return;
            }

            x = tip.x;
            y = tip.y;
            textLine = tip.textLine;
        }
        else
        {
            const node = findNodeById(document, state.selection.id);

            if (node === null)
            {
                return;
            }

            x = node.x;
            y = getNodeMarkerY(node);
            textLine = node.textLine;
            context.strokeStyle = "rgba(255, 200, 0, 0.9)";
            context.lineWidth = 3 * unit;
            context.beginPath();
            context.moveTo(node.x, node.y0);
            context.lineTo(node.x, node.y1);
            context.stroke();
        }

        context.strokeStyle = "rgba(255, 200, 0, 0.95)";
        context.lineWidth = 2 * unit;
        context.beginPath();
        context.arc(x, y, 9 * unit, 0, Math.PI * 2);
        context.stroke();

        if (textLine === null)
        {
            return;
        }

        for (const line of document.textLines)
        {
            if (line.id === textLine)
            {
                const { x0, y0, x1, y1 } = line.box;
                enterFrame(context, line.frame);
                context.strokeRect(x0 - unit, y0 - unit, x1 - x0 + 2 * unit, y1 - y0 + 2 * unit);
                leaveFrame(context, line.frame);
            }
        }
    }

    /**
     * Dims everything outside the analysis region and outlines it.
     *
     * @param context - Canvas context in image space.
     * @param state - Viewer state holding the region.
     * @param unit - Length of one screen pixel in image pixels.
     */
    private drawRegion(context: CanvasRenderingContext2D, state: ViewerState, unit: number): void
    {
        const box = state.draftRegion ?? state.region;

        if (box === null || state.bitmap === null)
        {
            return;
        }

        const x0 = Math.min(box.x0, box.x1);
        const x1 = Math.max(box.x0, box.x1);
        const y0 = Math.min(box.y0, box.y1);
        const y1 = Math.max(box.y0, box.y1);
        context.fillStyle = "rgba(0, 0, 0, 0.35)";
        context.fillRect(0, 0, state.bitmap.width, y0);
        context.fillRect(0, y1, state.bitmap.width, state.bitmap.height - y1);
        context.fillRect(0, y0, x0, y1 - y0);
        context.fillRect(x1, y0, state.bitmap.width - x1, y1 - y0);
        context.strokeStyle = state.draftRegion === null ? "rgba(9, 105, 218, 0.95)" : "rgba(9, 105, 218, 0.7)";
        context.lineWidth = 2 * unit;
        context.setLineDash([6 * unit, 4 * unit]);
        context.strokeRect(x0, y0, x1 - x0, y1 - y0);
        context.setLineDash([]);
    }
}
