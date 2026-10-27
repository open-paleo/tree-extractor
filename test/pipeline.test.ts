import assert from "node:assert/strict";
import { test } from "node:test";

import type { RgbaImage } from "../src/core/types.ts";
import { extractTree } from "../src/core/pipeline.ts";
import { formatDocumentAsNewick } from "../src/core/newick.ts";

/**
 * Builds a white RGBA canvas.
 */
function createBlankImage(width: number, height: number): RgbaImage
{
    const data = new Uint8ClampedArray(width * height * 4).fill(255);

    return { width, height, data };
}

/**
 * Paints a black rectangle.
 */
function paintRect(image: RgbaImage, x0: number, y0: number, x1: number, y1: number): void
{
    for (let y = y0; y < y1; y++)
    {
        for (let x = x0; x < x1; x++)
        {
            const offset = (y * image.width + x) * 4;
            image.data[offset] = 0;
            image.data[offset + 1] = 0;
            image.data[offset + 2] = 0;
        }
    }
}

test("extractTree traces a drawn tree with a polytomy and a range bar, without OCR", async () =>
{
    const image = createBlankImage(400, 220);
    // root stub and root node at x=60 spanning y 40..180
    paintRect(image, 20, 109, 60, 112);
    paintRect(image, 60, 40, 63, 183);
    // top child: node at x=160 spanning 40..80 with two tips
    paintRect(image, 60, 40, 160, 43);
    paintRect(image, 160, 40, 163, 83);
    paintRect(image, 160, 40, 300, 43);
    paintRect(image, 160, 80, 300, 83);
    // middle child: a three-way polytomy at x=200 spanning 110..170, its middle branch straight through
    paintRect(image, 60, 139, 200, 142);
    paintRect(image, 200, 110, 203, 173);
    paintRect(image, 200, 110, 320, 113);
    paintRect(image, 200, 139, 320, 142);
    paintRect(image, 200, 170, 320, 173);
    // bottom child: a tip with a thick range bar near its end
    paintRect(image, 60, 180, 260, 183);
    paintRect(image, 220, 178, 260, 186);

    const document = await extractTree(image, { parameters: { glyphStripHorizontalRun: 20, glyphStripVerticalRun: 20 } });
    assert.equal(formatDocumentAsNewick(document), "((t1,t2),(t3,t4,t5),t6);");
    assert.equal(document.tips.length, 6);
    assert.ok(document.qc.every((issue) => issue.severity !== "error"));
});

test("extractTree on a region reports coordinates of the full image", async () =>
{
    const image = createBlankImage(300, 160);
    paintRect(image, 60, 79, 100, 82);
    paintRect(image, 100, 40, 103, 123);
    paintRect(image, 100, 40, 220, 43);
    paintRect(image, 100, 120, 220, 123);

    const whole = await extractTree(image, { parameters: { glyphStripHorizontalRun: 20, glyphStripVerticalRun: 20 } });
    const part = await extractTree(image, { region: { x0: 50, y0: 30, x1: 260, y1: 140 }, parameters: { glyphStripHorizontalRun: 20, glyphStripVerticalRun: 20 } });
    assert.equal(formatDocumentAsNewick(part), "(t1,t2);");
    assert.deepEqual(part.image.region, { x0: 50, y0: 30, x1: 260, y1: 140 });
    assert.equal(part.image.width, 300);
    assert.equal(part.tips[0].x, whole.tips[0].x);
    assert.equal(part.tips[0].y, whole.tips[0].y);
    assert.equal(part.nodes[0].x, whole.nodes[0].x);
});

test("extractTree reports each stage through the progress reporter", async () =>
{
    const image = createBlankImage(300, 160);
    paintRect(image, 60, 79, 100, 82);
    paintRect(image, 100, 40, 103, 123);
    paintRect(image, 100, 40, 220, 43);
    paintRect(image, 100, 120, 220, 123);
    const stages = new Array<string>();
    const reporter = {
        report(stage: string): void
        {
            stages.push(stage);
        },
    };
    await extractTree(image, { progress: reporter, parameters: { glyphStripHorizontalRun: 20, glyphStripVerticalRun: 20 } });
    assert.deepEqual(stages, ["Preparing masks", "Finding segments", "Tracing the tree", "Finding labels"]);
});
