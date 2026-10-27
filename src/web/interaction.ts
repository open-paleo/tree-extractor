/**
 * Pointer and wheel handling on the canvas: zoom at the cursor, drag to pan, drag out a region,
 * click to select.
 */

import type { Box } from "../core/types.ts";
import type { DragState, Selection, ViewerState } from "./state.ts";
import type { CanvasView } from "./canvas.ts";
import { hitTest } from "./lookup.ts";

const clickSlop = 4;
const minRegionSize = 10;

/**
 * What the page does in response to interaction.
 */
export type InteractionCallbacks = {
    /**
     * Called when the user clicks a tip or node, or empty space (null).
     *
     * @param selection - What was clicked.
     */
    onSelect(selection: Selection | null): void;

    /**
     * Called when a region has been dragged out.
     *
     * @param region - The new region.
     */
    onRegionSet(region: Box): void;

    /**
     * Called when the user clicks where a tip should be added.
     *
     * @param x - Branch end x in image pixels.
     * @param y - Branch height in image pixels.
     */
    onAddTip(x: number, y: number): void;

    /**
     * Called when the user has dragged out the vertical of a node to add.
     *
     * @param x - Position of the vertical in image pixels.
     * @param y0 - Top.
     * @param y1 - Bottom.
     */
    onAddNode(x: number, y0: number, y1: number): void;

    /**
     * Called after the view transform or an overlay changed and the toolbar should refresh.
     */
    onViewChanged(): void;
};

/**
 * Routes canvas pointer events to the view and the viewer state.
 */
export class PointerController
{
    private readonly canvas: HTMLCanvasElement;

    private readonly canvasView: CanvasView;

    private readonly state: ViewerState;

    private readonly callbacks: InteractionCallbacks;

    private drag: DragState | null = null;

    /**
     * Attaches to a canvas.
     *
     * @param canvas - Canvas element receiving events.
     * @param canvasView - View to pan and zoom.
     * @param state - Viewer state to read and update.
     * @param callbacks - Page responses.
     */
    public constructor(canvas: HTMLCanvasElement, canvasView: CanvasView, state: ViewerState, callbacks: InteractionCallbacks)
    {
        this.canvas = canvas;
        this.canvasView = canvasView;
        this.state = state;
        this.callbacks = callbacks;
        canvas.addEventListener("wheel", this.handleWheel.bind(this), { passive: false });
        canvas.addEventListener("pointerdown", this.handlePointerDown.bind(this));
        canvas.addEventListener("pointermove", this.handlePointerMove.bind(this));
        canvas.addEventListener("pointerup", this.handlePointerUp.bind(this));
        canvas.addEventListener("pointercancel", this.handlePointerUp.bind(this));
    }

    /**
     * Zooms about the center of the canvas.
     *
     * @param factor - Multiplier for the scale.
     */
    public zoomAtCenter(factor: number): void
    {
        this.canvasView.zoomAt(this.state, this.canvasView.getWidth() / 2, this.canvasView.getHeight() / 2, factor);
        this.callbacks.onViewChanged();
    }

    /**
     * Zooms about the pointer on wheel.
     *
     * @param event - Wheel event.
     */
    private handleWheel(event: WheelEvent): void
    {
        if (this.state.bitmap === null)
        {
            return;
        }

        event.preventDefault();
        const bounds = this.canvas.getBoundingClientRect();
        this.canvasView.zoomAt(this.state, event.clientX - bounds.left, event.clientY - bounds.top, Math.exp(-event.deltaY * 0.0015));
        this.callbacks.onViewChanged();
    }

    /**
     * Begins a pan or a region drag.
     *
     * @param event - Pointer event.
     */
    private handlePointerDown(event: PointerEvent): void
    {
        if (this.state.bitmap === null || event.button !== 0)
        {
            return;
        }

        const bounds = this.canvas.getBoundingClientRect();
        const screenX = event.clientX - bounds.left;
        const screenY = event.clientY - bounds.top;
        this.drag = {
            pointerId: event.pointerId,
            startX: screenX,
            startY: screenY,
            startOffsetX: this.canvasView.view.offsetX,
            startOffsetY: this.canvasView.view.offsetY,
            moved: false,
        };
        this.canvas.setPointerCapture(event.pointerId);

        const imageX = this.canvasView.toImageX(screenX);
        const imageY = this.canvasView.toImageY(screenY);

        if (this.state.mode === "region")
        {
            this.state.draftRegion = { x0: imageX, y0: imageY, x1: imageX, y1: imageY };
        }
        else if (this.state.mode === "add-node")
        {
            this.state.draftSpan = { x0: imageX, y0: imageY, x1: imageX, y1: imageY };
        }
        else
        {
            this.canvas.classList.add("panning");
        }
    }

    /**
     * Continues a pan or a region drag.
     *
     * @param event - Pointer event.
     */
    private handlePointerMove(event: PointerEvent): void
    {
        const drag = this.drag;

        if (drag === null || event.pointerId !== drag.pointerId)
        {
            return;
        }

        const bounds = this.canvas.getBoundingClientRect();
        const screenX = event.clientX - bounds.left;
        const screenY = event.clientY - bounds.top;

        if (!drag.moved && Math.hypot(screenX - drag.startX, screenY - drag.startY) > clickSlop)
        {
            drag.moved = true;
        }

        if (!drag.moved)
        {
            return;
        }

        if (this.state.draftRegion !== null)
        {
            this.state.draftRegion.x1 = this.canvasView.toImageX(screenX);
            this.state.draftRegion.y1 = this.canvasView.toImageY(screenY);
            this.canvasView.render(this.state);
        }
        else if (this.state.draftSpan !== null)
        {
            this.state.draftSpan.y1 = this.canvasView.toImageY(screenY);
            this.canvasView.render(this.state);
        }
        else
        {
            this.canvasView.panTo(this.state, drag.startOffsetX + (screenX - drag.startX), drag.startOffsetY + (screenY - drag.startY));
        }
    }

    /**
     * Ends a drag: finishes the region, or treats a short press as a click that selects.
     *
     * @param event - Pointer event.
     */
    private handlePointerUp(event: PointerEvent): void
    {
        const drag = this.drag;

        if (drag === null || event.pointerId !== drag.pointerId)
        {
            return;
        }

        this.canvas.classList.remove("panning");
        this.canvas.releasePointerCapture(event.pointerId);
        this.drag = null;

        if (this.state.draftRegion !== null)
        {
            this.finishRegion(this.state.draftRegion, drag.moved);

            return;
        }

        if (this.state.draftSpan !== null)
        {
            this.finishSpan(this.state.draftSpan, drag.moved);

            return;
        }

        if (drag.moved || this.state.extraction === null)
        {
            return;
        }

        const imageX = this.canvasView.toImageX(drag.startX);
        const imageY = this.canvasView.toImageY(drag.startY);

        if (this.state.mode === "add-tip")
        {
            this.state.mode = "pan";
            this.callbacks.onAddTip(imageX, imageY);

            return;
        }

        const radius = 12 / this.canvasView.view.scale;
        this.callbacks.onSelect(hitTest(this.state.extraction, this.state.layers, imageX, imageY, radius));
    }

    /**
     * Turns a dragged-out vertical into a new node, if it has any height.
     *
     * @param draft - Draft span; x0 is the position, y0 and y1 the ends in either order.
     * @param moved - Whether the pointer actually moved.
     */
    private finishSpan(draft: Box, moved: boolean): void
    {
        this.state.draftSpan = null;
        this.state.mode = "pan";
        const top = Math.min(draft.y0, draft.y1);
        const bottom = Math.max(draft.y0, draft.y1);

        if (moved && bottom - top >= 2)
        {
            this.callbacks.onAddNode(draft.x0, top, bottom);
        }

        this.canvasView.render(this.state);
        this.callbacks.onViewChanged();
    }

    /**
     * Turns a dragged-out draft into the analysis region, if it is big enough.
     *
     * @param draft - Draft rectangle in image coordinates, any corner order.
     * @param moved - Whether the pointer actually moved.
     */
    private finishRegion(draft: Box, moved: boolean): void
    {
        this.state.draftRegion = null;
        this.state.mode = "pan";
        const x0 = Math.round(Math.min(draft.x0, draft.x1));
        const x1 = Math.round(Math.max(draft.x0, draft.x1));
        const y0 = Math.round(Math.min(draft.y0, draft.y1));
        const y1 = Math.round(Math.max(draft.y0, draft.y1));

        if (moved && x1 - x0 >= minRegionSize && y1 - y0 >= minRegionSize)
        {
            this.state.region = { x0, y0, x1, y1 };
            this.callbacks.onRegionSet(this.state.region);
        }

        this.canvasView.render(this.state);
        this.callbacks.onViewChanged();
    }
}
