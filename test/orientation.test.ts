import assert from "node:assert/strict";
import { test } from "node:test";

import type { RgbaImage } from "../src/core/types.ts";
import { rotateBox } from "../src/core/geometry.ts";
import { detectOrientation } from "../src/core/orientation.ts";
import { rotateRgbaQuarter, transposeMask } from "../src/core/raster.ts";

/**
 * A white image.
 *
 * @param width - Width.
 * @param height - Height.
 * @returns The image.
 */
function createWhiteImage(width: number, height: number): RgbaImage
{
    const data = new Uint8ClampedArray(width * height * 4);
    data.fill(255);

    return { width, height, data };
}

/**
 * Paints a filled black rectangle.
 *
 * @param image - Image painted in place.
 * @param x0 - Left column.
 * @param y0 - Top row.
 * @param x1 - Right column (exclusive).
 * @param y1 - Bottom row (exclusive).
 */
function paintBlack(image: RgbaImage, x0: number, y0: number, x1: number, y1: number): void
{
    for (let y = y0; y < y1; y++)
    {
        for (let x = x0; x < x1; x++)
        {
            const index = (y * image.width + x) * 4;
            image.data[index] = 0;
            image.data[index + 1] = 0;
            image.data[index + 2] = 0;
        }
    }
}

/**
 * Paints a pretend label: a row of small blobs the size of letters.
 *
 * @param image - Image painted in place.
 * @param x - Left end.
 * @param y - Top row.
 * @param letters - Number of blobs.
 */
function paintLabel(image: RgbaImage, x: number, y: number, letters: number): void
{
    for (let index = 0; index < letters; index++)
    {
        const left = x + index * 8;
        paintBlack(image, left, y, left + 5, y + 10);
        paintBlack(image, left + 1, y + 2, left + 2, y + 3);
    }
}

/**
 * Draws a root-left tree of four tips with a label after each tip, 200 by 120 pixels.
 *
 * @returns The image.
 */
function drawRootLeftTree(): RgbaImage
{
    const image = createWhiteImage(200, 120);
    const tipRows = [20, 45, 70, 95];

    for (const y of tipRows)
    {
        paintBlack(image, 60, y, 110, y + 3);
        paintLabel(image, 118, y - 4, 7);
    }

    paintBlack(image, 60, 20, 63, 48);
    paintBlack(image, 60, 70, 63, 98);
    paintBlack(image, 30, 33, 63, 36);
    paintBlack(image, 30, 83, 63, 86);
    paintBlack(image, 30, 33, 33, 86);
    paintBlack(image, 10, 58, 33, 61);

    return image;
}

test("rotateBox maps a box through each quarter turn and back", () =>
{
    const box = { x0: 10, y0: 20, x1: 40, y1: 50 };
    const once = rotateBox(box, 200, 100, 1);
    assert.deepEqual(once, { x0: 50, y0: 10, x1: 80, y1: 40 });
    assert.deepEqual(rotateBox(once, 100, 200, 3), box);
    assert.deepEqual(rotateBox(rotateBox(box, 200, 100, 2), 200, 100, 2), box);
    assert.deepEqual(rotateBox(box, 200, 100, 0), box);
});

test("rotateRgbaQuarter turns an image clockwise and counterclockwise", () =>
{
    const image = createWhiteImage(3, 2);
    paintBlack(image, 0, 0, 1, 1);
    const clockwise = rotateRgbaQuarter(image, true);
    assert.equal(clockwise.width, 2);
    assert.equal(clockwise.height, 3);
    // The top-left pixel moves to the top-right.
    assert.equal(clockwise.data[(0 * 2 + 1) * 4], 0);
    const counterclockwise = rotateRgbaQuarter(image, false);
    // The top-left pixel moves to the bottom-left.
    assert.equal(counterclockwise.data[(2 * 2 + 0) * 4], 0);
    // A clockwise turn undone by a counterclockwise one gives the image back.
    assert.deepEqual(rotateRgbaQuarter(clockwise, false).data, image.data);
});

test("transposeMask swaps the axes", () =>
{
    const mask = { width: 3, height: 2, data: new Uint8Array([1, 0, 0, 0, 0, 1]) };
    const transposed = transposeMask(mask);
    assert.equal(transposed.width, 2);
    assert.equal(transposed.height, 3);
    assert.deepEqual(Array.from(transposed.data), [1, 0, 0, 0, 0, 1]);
});

test("detectOrientation tells a root-left tree from the same tree on its side", () =>
{
    const image = drawRootLeftTree();
    const upright = detectOrientation(image, 140, 180, 40);
    assert.equal(upright.orientation, "root-left");
    assert.equal(upright.rightEnds, 4);
    // Turned counterclockwise the tips point up: a root-bottom tree.
    const rootBottom = detectOrientation(rotateRgbaQuarter(image, false), 140, 180, 40);
    assert.equal(rootBottom.orientation, "root-bottom");
    assert.equal(rootBottom.topEnds, 4);
    // Turned clockwise the tips point down: a root-top tree.
    const rootTop = detectOrientation(rotateRgbaQuarter(image, true), 140, 180, 40);
    assert.equal(rootTop.orientation, "root-top");
    assert.equal(rootTop.bottomEnds, 4);
});

test("detectOrientation leaves a figure with no labels undecided", () =>
{
    const image = createWhiteImage(200, 120);
    paintBlack(image, 60, 20, 110, 23);
    paintBlack(image, 60, 45, 110, 48);
    paintBlack(image, 60, 20, 63, 48);
    assert.equal(detectOrientation(image, 140, 180, 40).orientation, "unknown");
});
