import assert from "node:assert/strict";
import { test } from "node:test";

import type { ExtractionDocument, Mask, RgbaImage, Segment } from "../src/core/types.ts";
import { extendTipsThroughMarkers, removeFrameSegments, splitColoredInk } from "../src/core/markers.ts";
import { createEmptyProfile } from "../src/core/profile.ts";

/**
 * Builds a white image with a thin blue line and a fat blue disc.
 *
 * @returns The image.
 */
function createColoredImage(): RgbaImage
{
    const width = 120;
    const height = 60;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);

    function paint(x: number, y: number): void
    {
        const offset = (y * width + x) * 4;
        data[offset] = 20;
        data[offset + 1] = 60;
        data[offset + 2] = 200;
    }

    for (let x = 22; x < 70; x++)
    {
        paint(x, 30);
        paint(x, 31);
        paint(x, 32);
    }

    for (let y = 15; y < 45; y++)
    {
        for (let x = 75; x < 105; x++)
        {
            if ((x - 90) * (x - 90) + (y - 30) * (y - 30) <= 15 * 15)
            {
                paint(x, y);
            }
        }
    }

    // A thin colored rectangle, the outline of a clade box, with a gap where a branch crosses it.
    for (let x = 5; x < 115; x++)
    {
        if (x < 40 || x > 46)
        {
            paint(x, 3);
        }

        paint(x, 56);
    }

    for (let y = 3; y < 57; y++)
    {
        paint(5, y);
        paint(114, y);
    }

    return { width, height, data };
}

test("colored ink splits into a thin line and a fat marker", () =>
{
    const image = createColoredImage();
    const { thin, fat } = splitColoredInk(image, 150, 100, 4);
    assert.equal(thin.data[31 * image.width + 40], 1);
    assert.equal(fat.data[31 * image.width + 40], 0);
    assert.equal(fat.data[30 * image.width + 90], 1);
    assert.equal(thin.data[30 * image.width + 90], 0);
    assert.equal(fat.data[30 * image.width + 76], 1, "the rim of the disc belongs to the marker");
    assert.equal(thin.data[3 * image.width + 50], 0, "a box outline is neither line nor marker");
    assert.equal(fat.data[3 * image.width + 50], 0);
});

test("a frame's edges are dropped and ordinary segments kept", () =>
{
    const verticals: Array<Segment> = [
        { id: "v1", orientation: "vertical", box: { x0: 2, y0: 3, x1: 5, y1: 597 } },
        { id: "v2", orientation: "vertical", box: { x0: 200, y0: 100, x1: 203, y1: 400 } },
        { id: "v3", orientation: "vertical", box: { x0: 4, y0: 100, x1: 7, y1: 300 } },
    ];
    const horizontals: Array<Segment> = [
        { id: "h1", orientation: "horizontal", box: { x0: 3, y0: 596, x1: 798, y1: 599 } },
        { id: "h2", orientation: "horizontal", box: { x0: 3, y0: 300, x1: 798, y1: 303 } },
    ];
    const issues = [...removeFrameSegments(verticals, 800, 600), ...removeFrameSegments(horizontals, 800, 600)];
    assert.deepEqual(verticals.map((segment) => segment.id), ["v2", "v3"]);
    assert.deepEqual(horizontals.map((segment) => segment.id), ["h2"]);
    assert.equal(issues.length, 2);
});

test("a tip touching a marker moves to the marker's far side", () =>
{
    const width = 200;
    const height = 40;
    const data = new Uint8Array(width * height);

    for (let y = 10; y < 30; y++)
    {
        for (let x = 60; x < 120; x++)
        {
            data[y * width + x] = 1;
        }
    }

    const fat: Mask = { width, height, data };
    const document: ExtractionDocument = {
        version: 1,
        image: { width, height, source: null, region: null, quarterTurns: 0 },
        horizontals: [],
        verticals: [],
        textLines: [],
        nodes: [],
        tips: [
            { id: "t1", x: 58, y: 20, parent: null, textLine: null, label: null, match: null, source: "traced", age: null },
            { id: "t2", x: 58, y: 5, parent: null, textLine: null, label: null, match: null, source: "traced", age: null },
            { id: "t3", x: 30, y: 20, parent: null, textLine: null, label: null, match: null, source: "traced", age: null },
        ],
        root: null,
        qc: [],
        rejectedVerticals: [],
        branches: [],
        glyphHeight: 10,
        profile: createEmptyProfile(),
        timings: {},
    };
    assert.equal(extendTipsThroughMarkers(document, fat, 2, 10), 1);
    assert.equal(document.tips[0].x, 120);
    assert.equal(document.tips[1].x, 58);
    assert.equal(document.tips[2].x, 30, "a marker further than a glyph height away is not this tip's");
});
