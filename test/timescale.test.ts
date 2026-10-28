import assert from "node:assert/strict";
import { test } from "node:test";

import type { ExtractionDocument, GrayImage, Mask, Segment } from "../src/core/types.ts";
import { assignAges, computeAxisValue, fitAxisCalibration, findAxis, parseAxisNumber } from "../src/core/timescale.ts";
import { formatDocumentAsNewick } from "../src/core/newick.ts";
import { rotateGrayQuarter } from "../src/core/raster.ts";
import { createEmptyProfile } from "../src/core/profile.ts";

test("axis numbers survive the usual OCR confusions", () =>
{
    assert.equal(parseAxisNumber("130"), 130);
    assert.equal(parseAxisNumber("2O8.5"), 208.5);
    assert.equal(parseAxisNumber(" l00 "), 100);
    assert.equal(parseAxisNumber("66,0"), 66);
    assert.equal(parseAxisNumber("Maa."), null);
    assert.equal(parseAxisNumber(""), null);
});

test("a calibration is fit through labelled ticks and rejected when they scatter", () =>
{
    const fit = fitAxisCalibration([{ x: 100, value: 130 }, { x: 300, value: 120 }, { x: 500, value: 110 }, { x: 700, value: 100 }], 10);
    assert.ok(fit !== null);
    assert.ok(Math.abs(fit.pixelsPerUnit + 20) < 1e-9);
    assert.ok(Math.abs(fit.originX - 2700) < 1e-9);
    assert.equal(fit.points, 4);
    assert.ok(fit.residual < 1e-9);
    assert.equal(fitAxisCalibration([{ x: 100, value: 130 }, { x: 300, value: 120 }], 10), null);
    assert.equal(fitAxisCalibration([{ x: 100, value: 130 }, { x: 300, value: 120 }, { x: 320, value: 110 }, { x: 700, value: 100 }], 10), null);
});

test("a quarter turn each way swaps the axes and lands pixels where expected", () =>
{
    const image: GrayImage = { width: 3, height: 2, data: new Uint8ClampedArray([1, 2, 3, 4, 5, 6]) };
    const clockwise = rotateGrayQuarter(image, true);
    assert.equal(clockwise.width, 2);
    assert.equal(clockwise.height, 3);
    assert.deepEqual([...clockwise.data], [4, 1, 5, 2, 6, 3]);
    const counter = rotateGrayQuarter(image, false);
    assert.deepEqual([...counter.data], [3, 6, 2, 5, 1, 4]);
});

/**
 * Builds a document and ink with a horizontal axis line at y = 180 across a 400-pixel image
 * and eight tick marks hanging below it.
 *
 * @returns The document and the ink.
 */
function createAxisScene(): { document: ExtractionDocument; ink: Mask }
{
    const width = 400;
    const height = 200;
    const data = new Uint8Array(width * height);
    const verticals = new Array<Segment>();

    for (let x = 40; x < 400; x++)
    {
        data[180 * width + x] = 1;
        data[181 * width + x] = 1;
    }

    for (let tick = 0; tick < 8; tick++)
    {
        const x = 50 + tick * 45;

        for (let y = 182; y < 192; y++)
        {
            data[y * width + x] = 1;
            data[y * width + x + 1] = 1;
        }

        verticals.push({ id: `v${tick + 1}`, orientation: "vertical", box: { x0: x, y0: 182, x1: x + 2, y1: 192 } });
    }

    const document: ExtractionDocument = {
        version: 1,
        image: { width, height, source: null, region: null, quarterTurns: 0 },
        horizontals: [{ id: "h1", orientation: "horizontal", box: { x0: 40, y0: 180, x1: 400, y1: 182 } }],
        verticals,
        textLines: [],
        nodes: [],
        tips: [],
        root: null,
        qc: [],
        rejectedVerticals: [],
        branches: [],
        glyphHeight: 10,
        profile: createEmptyProfile(),
        timings: {},
    };

    return { document, ink: { width, height, data } };
}

test("an axis is found from the ticks hanging below its line", () =>
{
    const { document, ink } = createAxisScene();
    const axis = findAxis(document, ink, 10, 2);
    assert.ok(axis !== null);
    assert.equal(axis.y, 181);
    assert.ok(axis.ticksBelow);
    assert.equal(axis.ticks.length, 8);
    assert.ok(Math.abs(axis.ticks[0] - 50.5) <= 1);
    document.horizontals = [];
    const fromTicks = findAxis(document, ink, 10, 2);
    assert.ok(fromTicks !== null);
    assert.equal(fromTicks.ticks.length, 8);
});

test("ages follow the calibration and branch lengths reach the Newick", () =>
{
    const calibration = { originX: 2700, pixelsPerUnit: -20, points: 4, residual: 0 };
    assert.equal(computeAxisValue(calibration, 100), 130);
    const { document } = createAxisScene();
    document.nodes = [
        { id: "n1", x: 100, y0: 10, y1: 90, attachY: null, parent: null, children: ["t1", "n2"], textLine: null, label: null, source: "traced", age: null },
        { id: "n2", x: 300, y0: 50, y1: 90, attachY: 70, parent: "n1", children: ["t2", "t3"], textLine: null, label: "90", source: "traced", age: null },
    ];
    document.tips = [
        { id: "t1", x: 500, y: 10, parent: "n1", textLine: null, label: "A", match: null, source: "traced", age: null },
        { id: "t2", x: 700, y: 50, parent: "n2", textLine: null, label: "B", match: null, source: "traced", age: null },
        { id: "t3", x: 280, y: 90, parent: "n2", textLine: null, label: "C", match: null, source: "traced", age: null },
    ];
    document.root = "n1";
    const issues = assignAges(document, calibration);
    assert.deepEqual(issues.map((issue) => issue.code), ["ages-assigned", "branch-runs-backward"]);
    assert.equal(document.nodes[0].age, 130);
    assert.equal(document.tips[1].age, 100);
    assert.equal(formatDocumentAsNewick(document), "(A:20,(B:20,C:0)90:10);");
    assert.equal(formatDocumentAsNewick(document, { branchLengths: false }), "(A,(B,C)90);");
});
