/**
 * Pixel-level operations shared by the pipeline. Everything works on plain typed arrays so it
 * runs unchanged in Node and in the browser.
 */

import type { Box, GrayImage, Mask, RgbaImage } from "./types.ts";

/**
 * A connected group of set pixels in a mask.
 */
export type Component = {
    /**
     * Bounding box.
     */
    box: Box;

    /**
     * Number of pixels.
     */
    area: number;
};

/**
 * Converts an RGBA image to luminance.
 *
 * @param image - Source image.
 * @returns Single-channel image.
 */
export function convertToGray(image: RgbaImage): GrayImage
{
    const { width, height, data } = image;
    const gray = new Uint8ClampedArray(width * height);

    for (let index = 0; index < width * height; index++)
    {
        const offset = index * 4;
        gray[index] = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
    }

    return { width, height, data: gray };
}

/**
 * Marks dark pixels. With neutralOnly set, strongly colored pixels are left out, which
 * separates black line art from colored text and colored box borders.
 *
 * @param image - Source image.
 * @param threshold - Luminance below which a pixel counts as dark.
 * @param neutralOnly - Whether to require low chroma as well.
 * @param maxChroma - Largest channel spread still considered neutral.
 * @returns Mask of dark pixels.
 */
export function createDarkMask(image: RgbaImage, threshold: number, neutralOnly: boolean, maxChroma: number): Mask
{
    const { width, height, data } = image;
    const mask = new Uint8Array(width * height);

    for (let index = 0; index < width * height; index++)
    {
        const offset = index * 4;
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;

        if (luminance < threshold)
        {
            const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);

            if (!neutralOnly || chroma <= maxChroma)
            {
                mask[index] = 1;
            }
        }
    }

    return { width, height, data: mask };
}

/**
 * Hysteresis thresholding: keeps every pixel of the strong mask plus any pixel of the weak
 * mask that is 8-connected to a strong pixel through weak pixels. Faint stretches of a line
 * survive; faint regions touching nothing dark do not.
 *
 * @param strong - Pixels that are certainly ink.
 * @param weak - Pixels that may be ink.
 * @returns Combined mask.
 */
export function applyHysteresis(strong: Mask, weak: Mask): Mask
{
    const { width, height } = strong;
    const result = new Uint8Array(width * height);
    const stack = new Array<number>();

    for (let index = 0; index < width * height; index++)
    {
        if (strong.data[index] === 1)
        {
            result[index] = 1;
            stack.push(index);
        }
    }

    while (stack.length > 0)
    {
        const index = stack.pop() as number;
        const x = index % width;
        const y = (index - x) / width;

        for (let deltaY = -1; deltaY <= 1; deltaY++)
        {
            for (let deltaX = -1; deltaX <= 1; deltaX++)
            {
                const neighborX = x + deltaX;
                const neighborY = y + deltaY;

                if (neighborX >= 0 && neighborX < width && neighborY >= 0 && neighborY < height)
                {
                    const neighbor = neighborY * width + neighborX;

                    if (weak.data[neighbor] === 1 && result[neighbor] === 0)
                    {
                        result[neighbor] = 1;
                        stack.push(neighbor);
                    }
                }
            }
        }
    }

    return { width, height, data: result };
}

/**
 * Marks the pixels that belong to long straight runs of set pixels, horizontally or
 * vertically. This is what separates line art from glyphs.
 *
 * @param mask - Source mask.
 * @param minHorizontalRun - Shortest horizontal run that counts as a line.
 * @param minVerticalRun - Shortest vertical run that counts as a line.
 * @returns Mask of pixels inside long runs.
 */
export function createLongRunMask(mask: Mask, minHorizontalRun: number, minVerticalRun: number): Mask
{
    const { width, height, data } = mask;
    const result = new Uint8Array(width * height);

    for (let y = 0; y < height; y++)
    {
        let start = -1;

        for (let x = 0; x <= width; x++)
        {
            const on = x < width && data[y * width + x] === 1;

            if (on && start < 0)
            {
                start = x;
            }
            else if (!on && start >= 0)
            {
                if (x - start >= minHorizontalRun)
                {
                    result.fill(1, y * width + start, y * width + x);
                }

                start = -1;
            }
        }
    }

    for (let x = 0; x < width; x++)
    {
        let start = -1;

        for (let y = 0; y <= height; y++)
        {
            const on = y < height && data[y * width + x] === 1;

            if (on && start < 0)
            {
                start = y;
            }
            else if (!on && start >= 0)
            {
                if (y - start >= minVerticalRun)
                {
                    for (let row = start; row < y; row++)
                    {
                        result[row * width + x] = 1;
                    }
                }

                start = -1;
            }
        }
    }

    return { width, height, data: result };
}

/**
 * Grows every set pixel into a square of the given radius.
 *
 * @param mask - Source mask.
 * @param radius - Half-width of the square, in pixels.
 * @returns Dilated mask.
 */
export function dilate(mask: Mask, radius: number): Mask
{
    const { width, height, data } = mask;
    const result = new Uint8Array(width * height);

    for (let y = 0; y < height; y++)
    {
        for (let x = 0; x < width; x++)
        {
            if (data[y * width + x] === 1)
            {
                const top = Math.max(0, y - radius);
                const bottom = Math.min(height - 1, y + radius);
                const left = Math.max(0, x - radius);
                const right = Math.min(width - 1, x + radius);

                for (let row = top; row <= bottom; row++)
                {
                    result.fill(1, row * width + left, row * width + right + 1);
                }
            }
        }
    }

    return { width, height, data: result };
}

/**
 * Shrinks every set region by the given radius: a pixel survives only if its whole square
 * neighborhood is set.
 *
 * @param mask - Source mask.
 * @param radius - Half-width of the square, in pixels.
 * @returns Eroded mask.
 */
export function erode(mask: Mask, radius: number): Mask
{
    const { width, height, data } = mask;
    const result = new Uint8Array(width * height);

    for (let y = 0; y < height; y++)
    {
        for (let x = 0; x < width; x++)
        {
            if (data[y * width + x] === 0)
            {
                continue;
            }

            let keep = true;

            for (let row = y - radius; row <= y + radius && keep; row++)
            {
                for (let column = x - radius; column <= x + radius; column++)
                {
                    if (row < 0 || row >= height || column < 0 || column >= width || data[row * width + column] === 0)
                    {
                        keep = false;
                        break;
                    }
                }
            }

            if (keep)
            {
                result[y * width + x] = 1;
            }
        }
    }

    return { width, height, data: result };
}

/**
 * Morphological closing: fills gaps narrower than about twice the radius without thickening
 * what was already solid. Used to mend thin lines broken by compression.
 *
 * @param mask - Source mask.
 * @param radius - Half-width of the structuring square.
 * @returns Closed mask.
 */
export function closeMask(mask: Mask, radius: number): Mask
{
    return erode(dilate(mask, radius), radius);
}

/**
 * Marks pixels inside long runs in one direction only.
 *
 * @param mask - Source mask.
 * @param minRun - Shortest run to keep.
 * @param alongX - Whether to scan rows (true) or columns (false).
 * @returns Mask of pixels inside long runs in that direction.
 */
export function createDirectionalRunMask(mask: Mask, minRun: number, alongX: boolean): Mask
{
    return alongX ? createLongRunMask(mask, minRun, Number.MAX_SAFE_INTEGER) : createLongRunMask(mask, Number.MAX_SAFE_INTEGER, minRun);
}

/**
 * Flips every pixel of a mask.
 *
 * @param mask - Source mask.
 * @returns New mask set where the source was clear.
 */
export function invertMask(mask: Mask): Mask
{
    const result = new Uint8Array(mask.data.length);

    for (let index = 0; index < result.length; index++)
    {
        result[index] = mask.data[index] === 1 ? 0 : 1;
    }

    return { width: mask.width, height: mask.height, data: result };
}

/**
 * Clears from the first mask every pixel set in the second.
 *
 * @param mask - Mask to subtract from.
 * @param remove - Pixels to clear.
 * @returns New mask.
 */
export function subtractMask(mask: Mask, remove: Mask): Mask
{
    const result = new Uint8Array(mask.data.length);

    for (let index = 0; index < result.length; index++)
    {
        result[index] = mask.data[index] === 1 && remove.data[index] === 0 ? 1 : 0;
    }

    return { width: mask.width, height: mask.height, data: result };
}

/**
 * The result of labeling a mask's connected components.
 */
export type ComponentLabeling = {
    /**
     * Components in label order.
     */
    components: Array<Component>;

    /**
     * Per-pixel label: 0 for background, else the component's 1-based index.
     */
    labels: Int32Array;
};

/**
 * Labels 8-connected components of a mask.
 *
 * @param mask - Source mask.
 * @returns The components and the per-pixel labels.
 */
export function findConnectedComponents(mask: Mask): ComponentLabeling
{
    const { width, height, data } = mask;
    const labels = new Int32Array(width * height);
    const components = new Array<Component>();
    const stack = new Array<number>();

    for (let seed = 0; seed < width * height; seed++)
    {
        if (data[seed] === 0 || labels[seed] !== 0)
        {
            continue;
        }

        const label = components.length + 1;
        let x0 = width;
        let y0 = height;
        let x1 = 0;
        let y1 = 0;
        let area = 0;
        labels[seed] = label;
        stack.push(seed);

        while (stack.length > 0)
        {
            const index = stack.pop() as number;
            const x = index % width;
            const y = (index - x) / width;
            area++;
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y);

            for (let deltaY = -1; deltaY <= 1; deltaY++)
            {
                for (let deltaX = -1; deltaX <= 1; deltaX++)
                {
                    const neighborX = x + deltaX;
                    const neighborY = y + deltaY;

                    if (neighborX >= 0 && neighborX < width && neighborY >= 0 && neighborY < height)
                    {
                        const neighbor = neighborY * width + neighborX;

                        if (data[neighbor] === 1 && labels[neighbor] === 0)
                        {
                            labels[neighbor] = label;
                            stack.push(neighbor);
                        }
                    }
                }
            }
        }

        components.push({ box: { x0, y0, x1: x1 + 1, y1: y1 + 1 }, area });
    }

    return { components, labels };
}

/**
 * Builds a mask from the pixels of selected components.
 *
 * @param labels - Per-pixel labels from findConnectedComponents.
 * @param selected - 1-based component labels to keep.
 * @param width - Image width.
 * @param height - Image height.
 * @returns Mask of the selected components' pixels.
 */
export function createMaskFromComponents(labels: Int32Array, selected: Set<number>, width: number, height: number): Mask
{
    const data = new Uint8Array(width * height);

    for (let index = 0; index < data.length; index++)
    {
        if (selected.has(labels[index]))
        {
            data[index] = 1;
        }
    }

    return { width, height, data };
}

/**
 * Builds a mask covering a set of boxes.
 *
 * @param boxes - Boxes to fill.
 * @param width - Image width.
 * @param height - Image height.
 * @returns Mask set inside every box.
 */
export function createMaskFromBoxes(boxes: Iterable<Box>, width: number, height: number): Mask
{
    const data = new Uint8Array(width * height);

    for (const box of boxes)
    {
        const top = Math.max(0, box.y0);
        const bottom = Math.min(height, box.y1);
        const left = Math.max(0, box.x0);
        const right = Math.min(width, box.x1);

        for (let y = top; y < bottom; y++)
        {
            data.fill(1, y * width + left, y * width + right);
        }
    }

    return { width, height, data };
}

/**
 * Paints the set pixels of a mask with a constant value.
 *
 * @param image - Image to copy and paint.
 * @param mask - Pixels to paint.
 * @param value - Gray level to write.
 * @returns Painted copy.
 */
export function paintMask(image: GrayImage, mask: Mask, value: number): GrayImage
{
    const data = new Uint8ClampedArray(image.data);

    for (let index = 0; index < data.length; index++)
    {
        if (mask.data[index] === 1)
        {
            data[index] = value;
        }
    }

    return { width: image.width, height: image.height, data };
}

/**
 * Crops a padded box out of a gray image and upscales it with bilinear sampling.
 *
 * @param image - Source image.
 * @param box - Region of interest.
 * @param pad - Pixels of context to add on every side.
 * @param scale - Upscaling factor.
 * @param horizontalScale - Horizontal factor, when it should differ (condensing spaced text).
 * @returns The upscaled crop.
 */
export function cropAndScale(image: GrayImage, box: Box, pad: number, scale: number, horizontalScale = scale): GrayImage
{
    const left = Math.max(0, box.x0 - pad);
    const top = Math.max(0, box.y0 - pad);
    const right = Math.min(image.width, box.x1 + pad);
    const bottom = Math.min(image.height, box.y1 + pad);
    const sourceWidth = Math.max(1, right - left);
    const sourceHeight = Math.max(1, bottom - top);
    const width = Math.round(sourceWidth * horizontalScale);
    const height = Math.round(sourceHeight * scale);
    const data = new Uint8ClampedArray(width * height);

    for (let y = 0; y < height; y++)
    {
        const sourceY = Math.min(sourceHeight - 1, (y + 0.5) / scale - 0.5);
        const rowA = Math.max(0, Math.floor(sourceY));
        const rowB = Math.min(sourceHeight - 1, rowA + 1);
        const weightY = sourceY - rowA;

        for (let x = 0; x < width; x++)
        {
            const sourceX = Math.min(sourceWidth - 1, (x + 0.5) / horizontalScale - 0.5);
            const columnA = Math.max(0, Math.floor(sourceX));
            const columnB = Math.min(sourceWidth - 1, columnA + 1);
            const weightX = sourceX - columnA;
            const topLeft = image.data[(top + rowA) * image.width + left + columnA];
            const topRight = image.data[(top + rowA) * image.width + left + columnB];
            const bottomLeft = image.data[(top + rowB) * image.width + left + columnA];
            const bottomRight = image.data[(top + rowB) * image.width + left + columnB];
            const upper = topLeft + (topRight - topLeft) * weightX;
            const lower = bottomLeft + (bottomRight - bottomLeft) * weightX;
            data[y * width + x] = upper + (lower - upper) * weightY;
        }
    }

    return { width, height, data };
}

/**
 * Turns a luminance image a quarter turn.
 *
 * @param image - Source image.
 * @param clockwise - Direction of the turn.
 * @returns The turned image, with width and height swapped.
 */
export function rotateGrayQuarter(image: GrayImage, clockwise: boolean): GrayImage
{
    const { width, height } = image;
    const data = new Uint8ClampedArray(width * height);

    for (let y = 0; y < height; y++)
    {
        for (let x = 0; x < width; x++)
        {
            const value = image.data[y * width + x];

            if (clockwise)
            {
                data[x * height + (height - 1 - y)] = value;
            }
            else
            {
                data[(width - 1 - x) * height + y] = value;
            }
        }
    }

    return { width: height, height: width, data };
}

/**
 * Pixels set in either mask.
 *
 * @param left - First mask.
 * @param right - Second mask of the same size.
 * @returns The union.
 */
export function unionMask(left: Mask, right: Mask): Mask
{
    const data = new Uint8Array(left.data.length);

    for (let index = 0; index < data.length; index++)
    {
        data[index] = left.data[index] | right.data[index];
    }

    return { width: left.width, height: left.height, data };
}

/**
 * Keeps the connected components of a mask that share at least one pixel with a reference mask.
 *
 * @param mask - Mask whose components are tested.
 * @param reference - Mask the kept components must touch.
 * @returns Mask of the kept components.
 */
export function keepComponentsTouching(mask: Mask, reference: Mask): Mask
{
    const { labels } = findConnectedComponents(mask);
    const selected = new Set<number>();

    for (let index = 0; index < labels.length; index++)
    {
        if (labels[index] > 0 && reference.data[index] === 1)
        {
            selected.add(labels[index]);
        }
    }

    return createMaskFromComponents(labels, selected, mask.width, mask.height);
}

/**
 * Estimates the thickness of the lines in a mask: the median length of the vertical runs of
 * ink, counting runs. Every column of a horizontal contributes one run of the line's
 * thickness, so horizontals dominate the count; a vertical contributes only as many runs as it
 * is wide, however long it is.
 *
 * @param mask - Line mask.
 * @returns Thickness in pixels, at least 1.
 */
export function estimateLineThickness(mask: Mask): number
{
    const { width, height, data } = mask;
    const histogram = new Array<number>(height + 1).fill(0);
    let total = 0;

    for (let x = 0; x < width; x++)
    {
        let start = -1;

        for (let y = 0; y <= height; y++)
        {
            const on = y < height && data[y * width + x] === 1;

            if (on && start < 0)
            {
                start = y;
            }
            else if (!on && start >= 0)
            {
                histogram[y - start]++;
                total++;
                start = -1;
            }
        }
    }

    let seen = 0;

    for (let length = 1; length <= height; length++)
    {
        seen += histogram[length];

        if (seen * 2 >= total)
        {
            return length;
        }
    }

    return 1;
}

/**
 * Median of a list of numbers, or the fallback for an empty list.
 *
 * @param values - Numbers to summarize.
 * @param fallback - Value to return when the list is empty.
 * @returns The median.
 */
export function computeMedian(values: Array<number>, fallback: number): number
{
    if (values.length === 0)
    {
        return fallback;
    }

    const sorted = [...values].sort(compareNumbers);

    return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Orders numbers ascending.
 *
 * @param left - First number.
 * @param right - Second number.
 * @returns Their difference.
 */
export function compareNumbers(left: number, right: number): number
{
    return left - right;
}
