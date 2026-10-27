import assert from "node:assert/strict";
import { test } from "node:test";

import type { ExtractionDocument } from "../src/core/types.ts";
import { addNode, addTip, deleteNode, deleteTip } from "../src/core/edit.ts";
import { formatDocumentAsNewick } from "../src/core/newick.ts";

/**
 * A root at x=50 with tips at heights 20, 60 and 120 ending at x=150.
 */
function createFlatTree(): ExtractionDocument
{
    return {
        version: 1,
        image: { width: 200, height: 150, source: null, region: null },
        horizontals: [],
        verticals: [],
        textLines: [],
        nodes: [{ id: "n1", x: 50, y0: 20, y1: 120, attachY: null, parent: null, children: ["t1", "t2", "t3"], textLine: null, label: null, source: "traced" }],
        tips: [
            { id: "t1", x: 150, y: 20, parent: "n1", textLine: null, label: null, match: null, source: "traced" },
            { id: "t2", x: 150, y: 60, parent: "n1", textLine: null, label: null, match: null, source: "traced" },
            { id: "t3", x: 150, y: 120, parent: "n1", textLine: null, label: null, match: null, source: "traced" },
        ],
        root: "n1",
        qc: [],
        rejectedVerticals: [],
        branches: [],
        glyphHeight: 10,
        timings: {},
    };
}

/**
 * The flat tree with t2 and t3 grouped under n2 at x=100.
 */
function createNestedTree(): ExtractionDocument
{
    const document = createFlatTree();
    document.nodes.push({ id: "n2", x: 100, y0: 60, y1: 120, attachY: 90, parent: "n1", children: ["t2", "t3"], textLine: null, label: null, source: "traced" });
    document.nodes[0].children = ["t1", "n2"];
    document.tips[1].parent = "n2";
    document.tips[2].parent = "n2";

    return document;
}

test("addNode groups the children whose branches cross the new vertical", () =>
{
    const document = createFlatTree();
    const result = addNode(document, 100, 55, 125);
    assert.ok(result.ok, result.message);
    assert.equal(formatDocumentAsNewick(document), "(t1,(t2,t3));");
    assert.equal(document.nodes[1].source, "manual");
    assert.equal(document.tips[1].parent, result.id);
});

test("addNode refuses when nothing crosses the vertical", () =>
{
    const document = createFlatTree();
    assert.equal(addNode(document, 100, 80, 100).ok, false);
    assert.equal(formatDocumentAsNewick(document), "(t1,t2,t3);");
});

test("addTip hangs from the node to its left and sorts into place", () =>
{
    const document = createFlatTree();
    const result = addTip(document, 150, 90);
    assert.ok(result.ok);
    assert.equal(result.id, "t4");
    assert.equal(formatDocumentAsNewick(document), "(t1,t2,t4,t3);");
});

test("deleteTip collapses a parent left with one child", () =>
{
    const document = createNestedTree();
    assert.equal(formatDocumentAsNewick(document), "(t1,(t2,t3));");
    assert.ok(deleteTip(document, "t2").ok);
    assert.equal(formatDocumentAsNewick(document), "(t1,t3);");
    assert.equal(document.nodes.length, 1);
    assert.equal(document.tips[1].parent, "n1");
});

test("deleteNode dissolves it into a polytomy and refuses a branching root", () =>
{
    const document = createNestedTree();
    assert.ok(deleteNode(document, "n2").ok);
    assert.equal(formatDocumentAsNewick(document), "(t1,t2,t3);");
    assert.equal(deleteNode(document, "n1").ok, false);
});

test("new identifiers are unique among current elements", () =>
{
    const document = createNestedTree();
    deleteTip(document, "t3");
    const first = addTip(document, 150, 100);
    const second = addTip(document, 150, 110);
    assert.notEqual(first.id, second.id);
    assert.equal(document.tips.length, 4);
    const ids = new Set<string>();

    for (const tip of document.tips)
    {
        ids.add(tip.id);
    }

    assert.equal(ids.size, 4);
});
