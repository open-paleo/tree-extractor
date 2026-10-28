import assert from "node:assert/strict";
import { test } from "node:test";

import type { ExtractionDocument } from "../src/core/types.ts";
import { createEmptyProfile } from "../src/core/profile.ts";
import { renderTreeSvg } from "../src/core/render.ts";

/**
 * A document with a root node over a tip and a node of two tips, as a figure would place them.
 *
 * @param withAges - Give every member an age.
 * @returns The document.
 */
function createDocument(withAges: boolean): ExtractionDocument
{
    const age = withAges ? (value: number): number => value : (): null => null;

    return {
        version: 1,
        image: { width: 300, height: 200, source: null, region: null, quarterTurns: 0 },
        horizontals: [],
        verticals: [],
        textLines: [],
        nodes: [
            { id: "n1", x: 20, y0: 40, y1: 120, attachY: null, parent: null, children: ["n2", "t1"], textLine: null, label: null, source: "traced", age: age(100) },
            { id: "n2", x: 80, y0: 80, y1: 120, attachY: null, parent: "n1", children: ["t3", "t2"], textLine: null, label: "87", source: "traced", age: age(60) },
        ],
        tips: [
            { id: "t1", x: 200, y: 40, parent: "n1", textLine: null, label: "Alpha", match: null, source: "traced", age: age(0) },
            { id: "t2", x: 200, y: 80, parent: "n2", textLine: null, label: "Beta <b>", match: null, source: "traced", age: age(20) },
            { id: "t3", x: 200, y: 120, parent: "n2", textLine: null, label: null, match: { name: "Gamma delta", similarity: 1, margin: 1, accepted: true, source: "list" }, source: "traced", age: age(0) },
        ],
        root: "n1",
        qc: [],
        rejectedVerticals: [],
        branches: [],
        glyphHeight: 10,
        profile: createEmptyProfile(),
        timings: {},
    };
}

test("renderTreeSvg draws tips in figure order with their names escaped", () =>
{
    const svg = renderTreeSvg(createDocument(false));
    assert.ok(svg !== null);
    assert.ok(svg.startsWith("<svg "));
    const alpha = svg.indexOf(">Alpha<");
    const beta = svg.indexOf(">Beta &lt;b&gt;<");
    const gamma = svg.indexOf(">Gamma delta<");
    assert.ok(alpha > 0 && beta > alpha && gamma > beta, "tips keep the figure's top-to-bottom order");
    assert.ok(svg.includes(">87<"), "the node label is written");
    // In the stepped layout every tip ends on the same line.
    const tipXs = svg.match(/<text x="([0-9.]+)" y="[0-9.]+" dominant-baseline/g) ?? [];
    assert.equal(tipXs.length, 3);
    assert.equal(new Set(tipXs.map((text) => text.split("\"")[1])).size, 1);
});

test("renderTreeSvg sets depths from the ages and draws an axis when they are complete", () =>
{
    const svg = renderTreeSvg(createDocument(true));
    assert.ok(svg !== null);
    const tipXs = (svg.match(/<text x="([0-9.]+)" y="[0-9.]+" dominant-baseline/g) ?? []).map((text) => Number(text.split("\"")[1]));
    assert.equal(tipXs.length, 3);
    // Beta, at 20 units, ends short of Alpha and Gamma at 0.
    assert.ok(tipXs[1] < tipXs[0]);
    assert.equal(tipXs[0], tipXs[2]);
    assert.ok(svg.includes(">100<") && svg.includes(">0<"), "the axis has its end ticks");
    const stepped = renderTreeSvg(createDocument(true), { branchLengths: false });
    assert.ok(stepped !== null && !stepped.includes(">100<"), "without branch lengths there is no axis");
});

test("renderTreeSvg returns null without a tree", () =>
{
    const document = createDocument(false);
    document.root = null;
    assert.equal(renderTreeSvg(document), null);
});
