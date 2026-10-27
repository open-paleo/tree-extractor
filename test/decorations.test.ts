import assert from "node:assert/strict";
import { test } from "node:test";

import type { ExtractionDocument, Tip, TreeNode } from "../src/core/types.ts";
import { pruneDecorations } from "../src/core/decorations.ts";
import { createEmptyProfile } from "../src/core/profile.ts";

/**
 * Builds a node.
 *
 * @param id - Identifier.
 * @param x - Position of the vertical.
 * @param y0 - Top of the span.
 * @param y1 - Bottom of the span.
 * @param children - Child identifiers.
 * @param parent - Parent identifier, or null.
 * @returns The node.
 */
function createNode(id: string, x: number, y0: number, y1: number, children: Array<string>, parent: string | null): TreeNode
{
    return { id, x, y0, y1, attachY: null, parent, children, textLine: null, label: null, source: "traced" };
}

/**
 * Builds a tip.
 *
 * @param id - Identifier.
 * @param x - Branch end.
 * @param y - Row.
 * @param parent - Parent identifier.
 * @param textLine - Label row identifier, or null.
 * @returns The tip.
 */
function createTip(id: string, x: number, y: number, parent: string, textLine: string | null): Tip
{
    return { id, x, y, parent, textLine, label: null, match: null, source: "traced" };
}

/**
 * A main tree with four tips at x = 300 between y = 100 and 160, plus three disconnected
 * pieces: a bracket to the right of the labels, an unlabelled axis above the tree, and a
 * labelled clade inside the tree's extent that merely lost its connection.
 *
 * @returns The document.
 */
function createDocument(): ExtractionDocument
{
    const nodes = [
        createNode("n1", 100, 100, 160, ["t1", "t2", "t3", "t4"], null),
        createNode("n2", 500, 110, 150, ["t5", "t6"], null),
        createNode("n3", 150, 20, 40, ["t7", "t8"], null),
        createNode("n4", 200, 130, 140, ["t9", "t10"], null),
    ];
    const tips = [
        createTip("t1", 300, 100, "n1", "l1"),
        createTip("t2", 300, 120, "n1", "l2"),
        createTip("t3", 300, 140, "n1", "l3"),
        createTip("t4", 300, 160, "n1", "l4"),
        createTip("t5", 520, 110, "n2", "l5"),
        createTip("t6", 520, 150, "n2", null),
        createTip("t7", 400, 20, "n3", null),
        createTip("t8", 400, 40, "n3", null),
        createTip("t9", 300, 130, "n4", "l9"),
        createTip("t10", 300, 140, "n4", "l10"),
    ];

    return {
        version: 1,
        image: { width: 600, height: 200, source: null, region: null },
        horizontals: [],
        verticals: [],
        textLines: [
            { id: "l5", box: { x0: 530, y0: 104, x1: 580, y1: 116 }, glyphCount: 6, role: "tip", ocr: null },
            { id: "l9", box: { x0: 310, y0: 124, x1: 380, y1: 136 }, glyphCount: 8, role: "tip", ocr: null },
        ],
        nodes,
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

test("pieces beside the tree are dropped and a detached clade inside it is kept", () =>
{
    const document = createDocument();
    const issues = pruneDecorations(document);
    assert.deepEqual(issues.map((issue) => issue.code), ["decoration-dropped", "decoration-dropped"]);
    assert.ok(issues[0].message.includes("right of the tips"));
    assert.ok(issues[1].message.includes("above the tree"));
    assert.deepEqual(document.nodes.map((node) => node.id), ["n1", "n4"]);
    assert.deepEqual(document.tips.map((tip) => tip.id), ["t1", "t2", "t3", "t4", "t9", "t10"]);
    assert.equal(document.textLines[0].role, "unassigned");
    assert.equal(document.textLines[1].role, "tip");
});

test("a labelled piece above the tree is kept", () =>
{
    const document = createDocument();
    document.tips[6].textLine = "l7";
    const issues = pruneDecorations(document);
    assert.equal(issues.length, 1);
    assert.ok(document.nodes.some((node) => node.id === "n3"));
});
