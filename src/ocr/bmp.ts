/**
 * Encodes a gray image as an 8-bit BMP, the simplest container every OCR engine accepts in
 * both Node and the browser without an image library.
 */

import type { GrayImage } from "../core/types.ts";

/**
 * Encodes a gray image as BMP bytes.
 *
 * @param image - Image to encode.
 * @returns BMP file contents.
 */
export function encodeGrayBmp(image: GrayImage): Uint8Array
{
    const { width, height, data } = image;
    const rowBytes = Math.ceil(width / 4) * 4;
    const pixelBytes = rowBytes * height;
    const paletteBytes = 256 * 4;
    const offset = 14 + 40 + paletteBytes;
    const bytes = new Uint8Array(offset + pixelBytes);
    const view = new DataView(bytes.buffer);

    bytes[0] = 0x42;
    bytes[1] = 0x4d;
    view.setUint32(2, bytes.length, true);
    view.setUint32(10, offset, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, width, true);
    view.setInt32(22, height, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, 8, true);
    view.setUint32(30, 0, true);
    view.setUint32(34, pixelBytes, true);
    view.setInt32(38, 2835, true);
    view.setInt32(42, 2835, true);
    view.setUint32(46, 256, true);
    view.setUint32(50, 256, true);

    for (let level = 0; level < 256; level++)
    {
        const base = 54 + level * 4;
        bytes[base] = level;
        bytes[base + 1] = level;
        bytes[base + 2] = level;
        bytes[base + 3] = 0;
    }

    for (let y = 0; y < height; y++)
    {
        const sourceRow = (height - 1 - y) * width;
        bytes.set(data.subarray(sourceRow, sourceRow + width), offset + y * rowBytes);
    }

    return bytes;
}
