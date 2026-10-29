import assert from "node:assert/strict";
import { test } from "node:test";

import type { Mask, TreeNode } from "../src/core/types.ts";
import { findEndSide, thinMask, traceSlantedTree } from "../src/core/slanted.ts";

/**
 * A clear mask.
 *
 * @param width - Width.
 * @param height - Height.
 * @returns The mask.
 */
function createMask(width: number, height: number): Mask
{
    return { width, height, data: new Uint8Array(width * height) };
}

/**
 * Draws a thick line between two points.
 *
 * @param mask - Mask drawn in place.
 * @param x0 - Start column.
 * @param y0 - Start row.
 * @param x1 - End column.
 * @param y1 - End row.
 * @param thickness - Line thickness.
 */
function drawLine(mask: Mask, x0: number, y0: number, x1: number, y1: number, thickness: number): void
{
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    const half = thickness / 2;

    for (let step = 0; step <= steps; step++)
    {
        const cx = x0 + ((x1 - x0) * step) / steps;
        const cy = y0 + ((y1 - y0) * step) / steps;

        for (let y = Math.floor(cy - half); y <= Math.ceil(cy + half); y++)
        {
            for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++)
            {
                if (x >= 0 && y >= 0 && x < mask.width && y < mask.height && Math.hypot(x - cx, y - cy) <= half)
                {
                    mask.data[y * mask.width + x] = 1;
                }
            }
        }
    }
}

/**
 * Draws a ring.
 *
 * @param mask - Mask drawn in place.
 * @param centerX - Center column.
 * @param centerY - Center row.
 * @param radius - Radius to the ring's middle.
 * @param thickness - Ring thickness.
 */
function drawRing(mask: Mask, centerX: number, centerY: number, radius: number, thickness: number): void
{
    for (let y = centerY - radius - thickness; y <= centerY + radius + thickness; y++)
    {
        for (let x = centerX - radius - thickness; x <= centerX + radius + thickness; x++)
        {
            if (Math.abs(Math.hypot(x - centerX, y - centerY) - radius) <= thickness / 2)
            {
                mask.data[y * mask.width + x] = 1;
            }
        }
    }
}

/**
 * Counts set pixels.
 *
 * @param mask - Mask.
 * @returns Set pixels.
 */
function countSet(mask: Mask): number
{
    let count = 0;

    for (const value of mask.data)
    {
        count += value;
    }

    return count;
}

/**
 * A slanted cladogram: a trunk rising to the right from a root stub at the lower left, three
 * tip branches leaving it toward the upper right and the trunk's own end a fourth, and a
 * leader line from the trunk down to a label on the root side.
 *
 * @returns Line ink.
 */
function drawSlantedTree(): Mask
{
    const lineInk = createMask(460, 460);
    drawLine(lineInk, 10, 120, 40, 120, 6);
    drawLine(lineInk, 40, 120, 300, 380, 6);
    drawLine(lineInk, 105, 185, 400, 38, 6);
    drawLine(lineInk, 170, 250, 400, 135, 6);
    drawLine(lineInk, 235, 315, 400, 233, 6);
    drawLine(lineInk, 300, 380, 400, 330, 6);
    drawLine(lineInk, 140, 220, 90, 300, 4);

    return lineInk;
}

test("thinMask keeps a thick band at either slant as a one-pixel line", () =>
{
    for (const upRight of [false, true])
    {
        const mask = createMask(300, 300);
        drawLine(mask, 40, upRight ? 260 : 40, 260, upRight ? 40 : 260, 10);
        const skeleton = thinMask(mask);
        const pixels = countSet(skeleton);
        assert.ok(pixels >= 200 && pixels <= 260, `${upRight ? "up-right" : "down-right"} skeleton has ${pixels} pixels`);
    }
});

test("traceSlantedTree reads a slanted cladogram as a pectinate tree and drops the leader line", () =>
{
    const trace = traceSlantedTree(drawSlantedTree(), 6, 12);
    assert.equal(trace.result.tips.length, 4, `tips ${trace.result.tips.length}`);
    assert.ok(trace.result.root !== null);
    const nodes = trace.result.nodes.filter((node) => node.parent !== null || node.id === trace.result.root);
    assert.equal(nodes.length, 3, `nodes ${nodes.length}`);
    const leaders = trace.result.issues.find((issue) => issue.code === "leaders-dropped");
    assert.ok(leaders !== undefined && leaders.message.startsWith("1 "), leaders?.message);
    // The root node is the first departure, at the upper left; its own tip is the top one.
    const root = trace.result.nodes.find((node) => node.id === trace.result.root) as TreeNode;
    assert.ok(root.x < 130 && root.y0 < 210, `root at ${root.x},${root.y0}`);
    const rootTips = trace.result.tips.filter((tip) => tip.parent === root.id);
    assert.equal(rootTips.length, 1);
    assert.ok(rootTips[0].y < 60);
});

test("traceSlantedTree contracts a ring drawn around a node", () =>
{
    const lineInk = createMask(300, 300);
    drawLine(lineInk, 20, 150, 138, 150, 6);
    drawRing(lineInk, 150, 150, 9, 4);
    drawLine(lineInk, 158, 145, 280, 60, 6);
    drawLine(lineInk, 158, 155, 280, 240, 6);
    const trace = traceSlantedTree(lineInk, 6, 12);
    assert.equal(trace.result.tips.length, 2, `tips ${trace.result.tips.length}`);
    const nodes = trace.result.nodes.filter((node) => node.parent !== null || node.id === trace.result.root);
    assert.equal(nodes.length, 1, `nodes ${nodes.length}`);
    assert.ok(Math.abs(nodes[0].x - 150) < 16 && Math.abs(nodes[0].y0 - 150) < 16, `node at ${nodes[0].x},${nodes[0].y0}`);
});

test("findEndSide points toward the tips of a slanted tree", () =>
{
    assert.deepEqual(findEndSide(drawSlantedTree()), { x: 1, y: 0 });
});
