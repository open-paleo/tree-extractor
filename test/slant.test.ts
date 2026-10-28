import assert from "node:assert/strict";
import { test } from "node:test";

import type { Mask } from "../src/core/types.ts";
import { createRotatedFrame, mapPointFromFrame, mapPointToFrame } from "../src/core/geometry.ts";
import { measureLabelSlant, rotateMaskToFrame } from "../src/core/slant.ts";

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
 * Sets a filled rectangle.
 *
 * @param mask - Mask set in place.
 * @param x0 - Left column.
 * @param y0 - Top row.
 * @param x1 - Right column (exclusive).
 * @param y1 - Bottom row (exclusive).
 */
function fill(mask: Mask, x0: number, y0: number, x1: number, y1: number): void
{
    for (let y = Math.max(0, y0); y < Math.min(mask.height, y1); y++)
    {
        for (let x = Math.max(0, x0); x < Math.min(mask.width, x1); x++)
        {
            mask.data[y * mask.width + x] = 1;
        }
    }
}

/**
 * Paints rows of pretend letters, each row running at an angle from its start.
 *
 * @param mask - Mask painted in place.
 * @param angle - Slant in radians.
 * @param rows - Number of rows.
 * @returns Nothing.
 */
function paintSlantedRows(mask: Mask, angle: number, rows: number): void
{
    for (let row = 0; row < rows; row++)
    {
        const startX = 40;
        const startY = 30 + row * 40;

        for (let letter = 0; letter < 12; letter++)
        {
            const along = letter * 9;
            const x = Math.round(startX + along * Math.cos(angle));
            const y = Math.round(startY + along * Math.sin(angle));
            fill(mask, x, y, x + 6, y + 10);
        }
    }
}

test("mapPointToFrame and mapPointFromFrame invert each other", () =>
{
    const frame = createRotatedFrame({ x0: 100, y0: 50, x1: 400, y1: 250 }, 0.5);
    const point = mapPointToFrame(frame, 130, 80);
    const back = mapPointFromFrame(frame, point.x, point.y);
    assert.ok(Math.abs(back.x - 130) < 1e-9 && Math.abs(back.y - 80) < 1e-9);
    // Two points along the slant map to the same frame row.
    const first = mapPointToFrame(frame, 200, 100);
    const second = mapPointToFrame(frame, 200 + 50 * Math.cos(0.5), 100 + 50 * Math.sin(0.5));
    assert.ok(Math.abs(first.y - second.y) < 1e-9);
    assert.ok(second.x > first.x);
});

test("measureLabelSlant finds the angle of slanted rows and near zero for level ones", () =>
{
    const slanted = createMask(300, 300);
    paintSlantedRows(slanted, 0.45, 5);
    const measure = measureLabelSlant(slanted, { x0: 0, y0: 0, x1: 300, y1: 300 }, 10);
    assert.ok(measure.pairs >= 40, `pairs ${measure.pairs}`);
    assert.ok(Math.abs(measure.angle - 0.45) < 0.08, `angle ${measure.angle}`);
    assert.ok(measure.share >= 0.6, `share ${measure.share}`);
    const level = createMask(300, 300);
    paintSlantedRows(level, 0, 5);
    const levelMeasure = measureLabelSlant(level, { x0: 0, y0: 0, x1: 300, y1: 300 }, 10);
    assert.ok(Math.abs(levelMeasure.angle) < 0.05, `angle ${levelMeasure.angle}`);
});

test("rotateMaskToFrame brings slanted rows level", () =>
{
    const mask = createMask(300, 300);
    paintSlantedRows(mask, 0.45, 3);
    const zone = { x0: 0, y0: 0, x1: 300, y1: 300 };
    const frame = createRotatedFrame(zone, 0.45);
    const turned = rotateMaskToFrame(mask, zone, frame);
    // In the frame the first row's letters share their vertical extent.
    const first = mapPointToFrame(frame, 43, 35);
    const last = mapPointToFrame(frame, 43 + 99 * Math.cos(0.45), 35 + 99 * Math.sin(0.45));
    assert.ok(Math.abs(first.y - last.y) < 1.5);
    assert.equal(turned.data[Math.round(first.y) * turned.width + Math.round(first.x)], 1);
    assert.equal(turned.data[Math.round(last.y) * turned.width + Math.round(last.x)], 1);
});
