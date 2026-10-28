import assert from "node:assert/strict";
import { test } from "node:test";

import type { ExtractionDocument, Mask, TextLine, Tip, TreeNode } from "../src/core/types.ts";
import { checkTipAlignment, recoverAlignedTips } from "../src/core/alignment.ts";
import { createEmptyProfile } from "../src/core/profile.ts";

/**
 * Builds a document whose tips end on one line at x = 300 under one node, with a label row for
 * each tip and one extra label row at y = 140 that no tip owns.
 *
 * @returns The document.
 */
function createAlignedDocument(): ExtractionDocument
{
    const tips = new Array<Tip>();
    const textLines = new Array<TextLine>();

    for (let index = 0; index < 6; index++)
    {
        const y = 20 + index * 20;
        tips.push({ id: `t${index + 1}`, x: 300, y, parent: "n1", textLine: `l${index + 1}`, label: null, match: null, source: "traced", age: null });
        textLines.push({ id: `l${index + 1}`, box: { x0: 310, y0: y - 6, x1: 400, y1: y + 6 }, glyphCount: 10, role: "tip", ocr: null });
    }

    textLines.push({ id: "l7", box: { x0: 310, y0: 134, x1: 400, y1: 146 }, glyphCount: 10, role: "unassigned", ocr: null });
    const root: TreeNode = { id: "n1", x: 100, y0: 10, y1: 150, attachY: null, parent: null, children: tips.map((tip) => tip.id), textLine: null, label: null, source: "traced", age: null };
    const document: ExtractionDocument = {
        version: 1,
        image: { width: 420, height: 160, source: null, region: null, quarterTurns: 0 },
        horizontals: [],
        verticals: [],
        textLines,
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
    document.profile.tipAlignment = { aligned: true, x: 300, share: 1 };

    return document;
}

/**
 * Draws one horizontal branch into an otherwise empty mask.
 *
 * @param x0 - Left end.
 * @param x1 - Right end (exclusive).
 * @param y - Row.
 * @returns The mask.
 */
function createMaskWithBranch(x0: number, x1: number, y: number): Mask
{
    const width = 420;
    const height = 160;
    const data = new Uint8Array(width * height);

    for (let x = x0; x < x1; x++)
    {
        data[y * width + x] = 1;
        data[(y + 1) * width + x] = 1;
    }

    return { width, height, data };
}

test("a label row at the tip line with a branch in the ink gets its tip back", () =>
{
    const document = createAlignedDocument();
    const issues = recoverAlignedTips(document, createMaskWithBranch(100, 298, 140), 2, 10);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, "tip-recovered");
    assert.equal(document.tips.length, 7);
    const recovered = document.tips[6];
    assert.equal(recovered.x, 298);
    assert.equal(recovered.y, 140);
    assert.equal(recovered.parent, "n1");
    assert.equal(recovered.textLine, "l7");
    assert.equal(recovered.source, "traced");
    assert.ok(document.nodes[0].children.includes(recovered.id));
});

test("a label row with no ink behind it is reported but not given a tip", () =>
{
    const document = createAlignedDocument();
    assert.equal(recoverAlignedTips(document, createMaskWithBranch(0, 0, 140), 2, 10).length, 0);
    assert.equal(document.tips.length, 6);
    const issues = checkTipAlignment(document);
    assert.deepEqual(issues.map((issue) => issue.code), ["row-without-tip"]);
});

test("a tip far from the tip line is reported", () =>
{
    const document = createAlignedDocument();
    document.tips[2].x = 250;
    document.textLines[6].role = "node";
    const issues = checkTipAlignment(document);
    assert.deepEqual(issues.map((issue) => issue.code), ["tip-off-line"]);
    assert.equal(issues[0].subject, "t3");
});

test("nothing happens when the tips are not aligned", () =>
{
    const document = createAlignedDocument();
    document.profile.tipAlignment = { aligned: false, x: null, share: 0.3 };
    assert.equal(recoverAlignedTips(document, createMaskWithBranch(100, 298, 140), 2, 10).length, 0);
    assert.equal(checkTipAlignment(document).length, 0);
});
