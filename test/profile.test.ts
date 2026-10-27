import assert from "node:assert/strict";
import { test } from "node:test";

import type { ExtractionDocument, TextLine, TreeNode } from "../src/core/types.ts";
import type { Mask } from "../src/core/types.ts";
import { applyProfileOverrides, chooseCondensing, classifySupportLabel, createEmptyProfile, measureLayout, measureSlant, measureTipAlignment } from "../src/core/profile.ts";

/**
 * Builds a node with the given span and attachment.
 *
 * @param id - Identifier.
 * @param y0 - Top of the span.
 * @param y1 - Bottom of the span.
 * @param attachY - Where the parent branch meets it.
 * @returns The node.
 */
function createNode(id: string, y0: number, y1: number, attachY: number): TreeNode
{
    return { id, x: 100, y0, y1, attachY, parent: "n0", children: [], textLine: null, label: null, source: "traced", age: null };
}

/**
 * Builds a document with tips at the given x positions, all connected to one root.
 *
 * @param xs - Tip x positions.
 * @returns The document.
 */
function createDocumentWithTips(xs: Array<number>): ExtractionDocument
{
    const tips = xs.map((x, index) => ({ id: `t${index + 1}`, x, y: index * 10, parent: "n1", textLine: null, label: null, match: null, source: "traced" as const, age: null }));
    const root: TreeNode = { id: "n1", x: 10, y0: 0, y1: xs.length * 10, attachY: null, parent: null, children: tips.map((tip) => tip.id), textLine: null, label: null, source: "traced", age: null };

    return {
        version: 1,
        image: { width: 500, height: 500, source: null, region: null },
        horizontals: [],
        verticals: [],
        textLines: [],
        nodes: [root],
        tips,
        root: "n1",
        qc: [],
        rejectedVerticals: [],
        branches: [],
        glyphHeight: 10,
        profile: createEmptyProfile(),
        timings: {},
    };
}

test("parent branches at the ends of spans mean a staircase layout", () =>
{
    const nodes = [createNode("n1", 0, 100, 0), createNode("n2", 0, 80, 2), createNode("n3", 10, 90, 10), createNode("n4", 0, 50, 25)];
    const connected = new Set(["n1", "n2", "n3", "n4"]);
    const vote = measureLayout(nodes, connected, 2);
    assert.equal(vote.value, "staircase");
    assert.ok(vote.confidence > 0.5);
});

test("parent branches inside spans mean a centered layout", () =>
{
    const nodes = [createNode("n1", 0, 100, 50), createNode("n2", 0, 80, 40), createNode("n3", 10, 90, 30), createNode("n4", 0, 50, 0)];
    const vote = measureLayout(nodes, new Set(["n1", "n2", "n3", "n4"]), 2);
    assert.equal(vote.value, "centered");
});

test("too few nodes leave the layout unknown", () =>
{
    const vote = measureLayout([createNode("n1", 0, 100, 0)], new Set(["n1"]), 2);
    assert.equal(vote.value, "unknown");
});

test("tips ending at one x are aligned", () =>
{
    const document = createDocumentWithTips([400, 401, 400, 399, 402, 400, 300, 400, 401, 400]);
    const alignment = measureTipAlignment(document, new Set(document.tips.map((tip) => tip.id).concat(["n1"])), 10);
    assert.ok(alignment.aligned);
    assert.equal(alignment.x, 400);
    assert.equal(alignment.share, 0.9);
});

test("tips ending at many x are not aligned", () =>
{
    const document = createDocumentWithTips([100, 150, 200, 250, 300, 350, 400, 450]);
    const alignment = measureTipAlignment(document, new Set(document.tips.map((tip) => tip.id).concat(["n1"])), 10);
    assert.ok(!alignment.aligned);
    assert.equal(alignment.x, null);
});

test("support labels are classified by where they sit", () =>
{
    const node = createNode("n1", 100, 200, 150);
    const above: TextLine = { id: "l1", box: { x0: 70, y0: 130, x1: 98, y1: 146 }, glyphCount: 2, role: "node", ocr: null };
    const boxed: TextLine = { id: "l2", box: { x0: 60, y0: 142, x1: 90, y1: 158 }, glyphCount: 2, role: "node", ocr: null };
    const atNode: TextLine = { id: "l3", box: { x0: 104, y0: 152, x1: 130, y1: 168 }, glyphCount: 2, role: "node", ocr: null };
    assert.equal(classifySupportLabel(node, above, 10), "above-branch");
    assert.equal(classifySupportLabel(node, boxed, 10), "boxed-on-branch");
    assert.equal(classifySupportLabel(node, atNode, 10), "at-node");
});

/**
 * Draws a row of leaning stems into a mask and describes it as one text line.
 *
 * @param lean - Horizontal shift per unit height.
 * @param stemHeight - Height of each stem in pixels.
 * @returns The mask and its text line.
 */
function createStems(lean: number, stemHeight: number): { mask: Mask; line: TextLine }
{
    const width = 400;
    const height = stemHeight + 10;
    const data = new Uint8Array(width * height);
    const top = 5;

    for (let stem = 0; stem < 20; stem++)
    {
        const foot = 20 + stem * 18;

        for (let row = 0; row < stemHeight; row++)
        {
            const y = top + stemHeight - 1 - row;
            const x = Math.round(foot + lean * row);
            data[y * width + x] = 1;
            data[y * width + x + 1] = 1;
        }
    }

    const mask: Mask = { width, height, data };
    const line: TextLine = { id: "l1", box: { x0: 10, y0: top, x1: 390, y1: top + stemHeight }, glyphCount: 20, role: "tip", ocr: null };

    return { mask, line };
}

test("the slant of leaning stems is recovered, upright stems give zero", () =>
{
    for (const stemHeight of [9, 12, 24])
    {
        const italic = createStems(0.24, stemHeight);
        const rows = [italic.line, italic.line, italic.line];
        const measured = measureSlant(italic.mask, rows, stemHeight) ?? Number.NaN;
        assert.ok(Math.abs(measured - 0.24) <= 0.04, `stems ${stemHeight} px: measured ${measured}`);
        const upright = createStems(0, stemHeight);
        assert.equal(measureSlant(upright.mask, [upright.line, upright.line, upright.line], stemHeight), 0);
    }

    const single = createStems(0.24, 12);
    assert.equal(measureSlant(single.mask, [single.line], 12), null);
});

test("label crops are condensed only for letter-spaced text", () =>
{
    assert.equal(chooseCondensing(0.1), 1);
    assert.equal(chooseCondensing(0.24), 1);
    assert.equal(chooseCondensing(0.67), 0.55);
    assert.ok(Math.abs(chooseCondensing(0.3) - 0.55) < 1e-9);
    assert.ok(Math.abs(chooseCondensing(0.2) - 1) < 1e-9);
});

test("overrides replace measured values and are recorded once", () =>
{
    const profile = createEmptyProfile();
    applyProfileOverrides(profile, { layout: "staircase", condensing: 0.3, widenText: true });
    applyProfileOverrides(profile, { layout: "staircase" });
    assert.equal(profile.layout, "staircase");
    assert.equal(profile.confidence.layout, 1);
    assert.equal(profile.font.condensing, 0.55);
    assert.deepEqual(profile.overridden, ["layout", "font.widened", "font.condensing"]);
});
