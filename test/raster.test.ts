import assert from "node:assert/strict";
import { test } from "node:test";

import type { Mask } from "../src/core/types.ts";
import { dilate, erode } from "../src/core/raster.ts";

/**
 * The square-neighborhood definition, written the slow way, as the reference.
 *
 * @param mask - Source mask.
 * @param radius - Half-width of the square.
 * @param requireAll - True for erode, false for dilate.
 * @returns The transformed mask.
 */
function transformSlowly(mask: Mask, radius: number, requireAll: boolean): Mask
{
    const { width, height, data } = mask;
    const result = new Uint8Array(width * height);

    for (let y = 0; y < height; y++)
    {
        for (let x = 0; x < width; x++)
        {
            let any = false;
            let all = true;

            for (let row = y - radius; row <= y + radius; row++)
            {
                for (let column = x - radius; column <= x + radius; column++)
                {
                    const inside = row >= 0 && row < height && column >= 0 && column < width;
                    const set = inside && data[row * width + column] === 1;
                    any ||= set;
                    all &&= set;
                }
            }

            result[y * width + x] = requireAll ? (all ? 1 : 0) : (any ? 1 : 0);
        }
    }

    return { width, height, data: result };
}

/**
 * A deterministic pseudo-random mask.
 *
 * @param width - Width.
 * @param height - Height.
 * @param seed - Seed.
 * @param density - Share of set pixels.
 * @returns The mask.
 */
function createRandomMask(width: number, height: number, seed: number, density: number): Mask
{
    const data = new Uint8Array(width * height);
    let state = seed;

    for (let index = 0; index < data.length; index++)
    {
        state = (state * 1103515245 + 12345) % 2147483648;
        data[index] = state / 2147483648 < density ? 1 : 0;
    }

    return { width, height, data };
}

test("separable dilate and erode match the square-neighborhood definition", () =>
{
    // Densities below about a tenth take the sparse path, the rest the separable sweeps.
    for (const [width, height, radius, density] of [[17, 11, 1, 0.3], [23, 19, 2, 0.5], [40, 9, 3, 0.8], [7, 30, 4, 0.9], [5, 5, 6, 0.6], [60, 40, 1, 0.05], [60, 40, 2, 0.02], [30, 30, 3, 0.01]])
    {
        const mask = createRandomMask(width, height, width * 31 + height, density);
        assert.deepEqual([...dilate(mask, radius).data], [...transformSlowly(mask, radius, false).data], `dilate ${width}x${height} r${radius}`);
        assert.deepEqual([...erode(mask, radius).data], [...transformSlowly(mask, radius, true).data], `erode ${width}x${height} r${radius}`);
    }
});
