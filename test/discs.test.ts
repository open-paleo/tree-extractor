import assert from "node:assert/strict";
import { test } from "node:test";

import type { Mask } from "../src/core/types.ts";
import { findNodeDiscs, paintCrosses } from "../src/core/markers.ts";
import { compareTokenSets, normalizeName } from "../src/core/matching.ts";
import { cleanTaxonText, isHigherTaxonName, isRubbleWord } from "../src/core/labels.ts";

/**
 * A clear mask.
 *
 * @param width - Width.
 * @param height - Height.
 * @returns The mask.
 */
function createMask(width: number, height: number): Mask
{
    return { width, height, data: new Uint8Array(width * height) };
}

/**
 * Sets a filled rectangle.
 *
 * @param mask - Mask set in place.
 * @param x0 - Left column.
 * @param y0 - Top row.
 * @param x1 - Right column (exclusive).
 * @param y1 - Bottom row (exclusive).
 */
function fill(mask: Mask, x0: number, y0: number, x1: number, y1: number): void
{
    for (let y = Math.max(0, y0); y < Math.min(mask.height, y1); y++)
    {
        for (let x = Math.max(0, x0); x < Math.min(mask.width, x1); x++)
        {
            mask.data[y * mask.width + x] = 1;
        }
    }
}

/**
 * Sets a filled disc.
 *
 * @param mask - Mask set in place.
 * @param centerX - Center column.
 * @param centerY - Center row.
 * @param radius - Radius.
 */
function fillDisc(mask: Mask, centerX: number, centerY: number, radius: number): void
{
    for (let y = centerY - radius; y <= centerY + radius; y++)
    {
        for (let x = centerX - radius; x <= centerX + radius; x++)
        {
            if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius * radius)
            {
                mask.data[y * mask.width + x] = 1;
            }
        }
    }
}

/**
 * A figure piece: a branch from the left into a node disc with a digit knocked out, and the
 * node's vertical through it, in a text mask and a line mask.
 *
 * @returns Both masks.
 */
function drawDiscJunction(): { textInk: Mask; lineInk: Mask }
{
    const textInk = createMask(200, 120);
    const lineInk = createMask(200, 120);

    for (const mask of [textInk, lineInk])
    {
        fill(mask, 10, 57, 100, 63);
        fill(mask, 97, 20, 103, 100);
        fill(mask, 100, 20, 160, 26);
        fill(mask, 100, 94, 160, 100);
    }

    fillDisc(textInk, 100, 60, 18);
    // The white digit: a vertical stroke and two bowls of a "8", roughly.
    for (let y = 48; y < 72; y++)
    {
        for (let x = 94; x < 106; x++)
        {
            if (x === 94 || x === 105 || y === 48 || y === 59 || y === 71)
            {
                textInk.data[y * textInk.width + x] = 0;
            }
        }
    }

    return { textInk, lineInk };
}

test("findNodeDiscs finds a numbered node disc and paintCrosses runs the lines through it", () =>
{
    const { textInk, lineInk } = drawDiscJunction();
    const discs = findNodeDiscs(textInk, lineInk, 16, 6);
    assert.equal(discs.length, 1);
    const disc = discs[0];
    assert.ok(disc.x0 <= 84 && disc.x1 >= 116 && disc.y0 <= 44 && disc.y1 >= 76, JSON.stringify(disc));
    paintCrosses(lineInk, discs, 6);
    // The disc body is gone from the corners and the arms are there through the center.
    assert.equal(lineInk.data[46 * 200 + 88], 0);
    assert.equal(lineInk.data[60 * 200 + 90], 1);
    assert.equal(lineInk.data[50 * 200 + 100], 1);
});

test("findNodeDiscs ignores a two-digit support value and a lone disc", () =>
{
    const textInk = createMask(200, 120);
    const lineInk = createMask(200, 120);
    fill(lineInk, 10, 57, 190, 63);
    fill(textInk, 10, 57, 190, 63);
    // Two hollow digits above the branch, together nearly square but a third inked.
    for (const left of [80, 98])
    {
        fill(textInk, left, 26, left + 14, 50);
        fill(textInk, left + 3, 29, left + 11, 47);

        for (let y = 29; y < 47; y++)
        {
            for (let x = left + 3; x < left + 11; x++)
            {
                textInk.data[y * 200 + x] = 0;
            }
        }
    }

    assert.equal(findNodeDiscs(textInk, lineInk, 16, 6).length, 0);
    const lone = createMask(200, 120);
    fillDisc(lone, 100, 60, 18);
    assert.equal(findNodeDiscs(lone, createMask(200, 120), 16, 6).length, 0);
});

test("compareTokenSets matches the same words in another order and needs two of them", () =>
{
    assert.equal(compareTokenSets(normalizeName("MOR 692 Avaceratops"), normalizeName("Avaceratops sp. MOR 692")), 1);
    assert.equal(compareTokenSets(normalizeName("Avaceratops"), normalizeName("Avaceratops sp. MOR 692")), 0);
    assert.ok(compareTokenSets(normalizeName("Avaceratops lammersi type"), normalizeName("Avaceratops sp. MOR 692")) < 0.5);
});

test("cleanTaxonText drops the rubble a dashed bar reads as and keeps real names", () =>
{
    assert.equal(cleanTaxonText("cmmmmmmmnn immemmmeem CPC 279"), "CPC 279");
    assert.equal(cleanTaxonText("imi Confuciusornithidae"), "Confuciusornithidae");
    assert.equal(cleanTaxonText("Callilestes latae"), "Callilestes latae");
    assert.ok(isRubbleWord("cmmmmmmmnn") && isRubbleWord("immemmmeem") && !isRubbleWord("Callilestes") && !isRubbleWord("CPC"));
});

test("isHigherTaxonName knows a family or an order from a genus", () =>
{
    assert.ok(isHigherTaxonName("Ornithomimosauria") && isHigherTaxonName("Compsognathidae") && isHigherTaxonName("Alvarezsauroidea"));
    assert.ok(!isHigherTaxonName("Ornithomimus") && !isHigherTaxonName("Saturnalia") && !isHigherTaxonName("Avaceratops sp. MOR 692"));
});
