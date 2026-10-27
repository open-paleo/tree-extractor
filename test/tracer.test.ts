import assert from "node:assert/strict";
import { test } from "node:test";

import type { Mask } from "../src/core/types.ts";
import { extractSegments } from "../src/core/segments.ts";
import { traceRectangularTree } from "../src/core/tracer.ts";
import { formatDocumentAsNewick } from "../src/core/newick.ts";
import type { ExtractionDocument } from "../src/core/types.ts";
import { createEmptyProfile } from "../src/core/profile.ts";

/**
 * Draws a filled rectangle into a mask.
 */
function paintRect(mask: Mask, x0: number, y0: number, x1: number, y1: number): void
{
    for (let y = y0; y < y1; y++)
    {
        for (let x = x0; x < x1; x++)
        {
            mask.data[y * mask.width + x] = 1;
        }
    }
}

/**
 * Draws a horizontal line two pixels thick.
 */
function drawHorizontal(mask: Mask, x0: number, x1: number, y: number): void
{
    paintRect(mask, x0, y, x1, y + 2);
}

/**
 * Draws a vertical line two pixels thick.
 */
function drawVertical(mask: Mask, x: number, y0: number, y1: number): void
{
    paintRect(mask, x, y0, x + 2, y1 + 2);
}

/**
 * Builds a document around a trace so the Newick writer can be used, naming tips by y order.
 */
function traceMaskToNewick(mask: Mask): string
{
    const { horizontals, verticals } = extractSegments(mask, 6, 4);
    const trace = traceRectangularTree(horizontals, verticals, 3);
    const document: ExtractionDocument = {
        version: 1,
        profile: createEmptyProfile(),
        image: { width: mask.width, height: mask.height, source: null, region: null },
        horizontals,
        verticals,
        textLines: [],
        nodes: trace.nodes,
        tips: trace.tips,
        root: trace.root,
        qc: trace.issues,
        rejectedVerticals: [],
        branches: [],
        glyphHeight: 10,
        timings: {},
    };

    return formatDocumentAsNewick(document) ?? "";
}

test("traces a binary tree with a root stub", () =>
{
    const mask: Mask = { width: 200, height: 100, data: new Uint8Array(200 * 100) };
    // root stub into node at x=40 spanning y 20..80; children: tip at y=20, node at x=100 (y 50..80)
    drawHorizontal(mask, 10, 40, 50);
    drawVertical(mask, 40, 20, 80);
    drawHorizontal(mask, 40, 150, 20);
    drawHorizontal(mask, 40, 100, 65);
    drawVertical(mask, 100, 50, 80);
    drawHorizontal(mask, 100, 150, 50);
    drawHorizontal(mask, 100, 150, 80);
    assert.equal(traceMaskToNewick(mask), "(t1,(t2,t3));");
});

test("traces a polytomy whose middle child continues the parent branch", () =>
{
    const mask: Mask = { width: 200, height: 120, data: new Uint8Array(200 * 120) };
    // parent branch arrives at x=60 at y=60; vertical spans 30..90; children at 30, 60 (straight through) and 90
    drawHorizontal(mask, 10, 60, 60);
    drawVertical(mask, 60, 30, 90);
    drawHorizontal(mask, 60, 150, 30);
    drawHorizontal(mask, 60, 150, 60);
    drawHorizontal(mask, 60, 150, 90);
    // a second node on the top child to make the root non-trivial
    assert.equal(traceMaskToNewick(mask), "(t1,t2,t3);");
});

test("ignores a rectangle and unattached lines", () =>
{
    const mask: Mask = { width: 220, height: 120, data: new Uint8Array(220 * 120) };
    drawHorizontal(mask, 10, 40, 50);
    drawVertical(mask, 40, 20, 80);
    drawHorizontal(mask, 40, 120, 20);
    drawHorizontal(mask, 40, 120, 80);
    // box
    drawHorizontal(mask, 150, 210, 10);
    drawHorizontal(mask, 150, 210, 100);
    drawVertical(mask, 150, 10, 100);
    drawVertical(mask, 210, 10, 100);
    // stray axis line
    drawHorizontal(mask, 0, 219, 115);
    assert.equal(traceMaskToNewick(mask), "(t1,t2);");
});
