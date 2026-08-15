import {readFileSync} from "node:fs";
import {inflateSync} from "node:zlib";

// Bytes per pixel: only 8-bit RGBA (color type 6, depth 8) is read, which is what TexturePacker's
// sources are. Anything else throws rather than decoding to nonsense.
const BYTES_PER_PIXEL = 4;
const COLOR_TYPE_RGBA = 6;
const BIT_DEPTH = 8;
const HEADER_LENGTH = 8;

/**
 * Decodes a non-interlaced 8-bit RGBA PNG. Enough to read a sprite's own pixels in a test without
 * pulling in an image dependency.
 * @param {string} path
 * @returns {{width: number, height: number, pixels: Buffer}} pixels are RGBA, row-major
 */
export function decodePng(path) {
    const buffer = readFileSync(path);
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (buffer[24] !== BIT_DEPTH || buffer[25] !== COLOR_TYPE_RGBA) {
        throw new Error(`${path}: only 8-bit RGBA PNGs are supported (depth ${buffer[24]}, color type ${buffer[25]})`);
    }
    if (buffer[28] !== 0) {
        throw new Error(`${path}: interlaced PNGs are not supported`);
    }

    const parts = [];
    let offset = HEADER_LENGTH;
    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString("ascii", offset + 4, offset + 8);
        if (type === "IDAT") {
            parts.push(buffer.subarray(offset + 8, offset + 8 + length));
        }
        // Length + type + data + CRC.
        offset += length + 12;
    }
    return {width, height, pixels: unfilter(inflateSync(Buffer.concat(parts)), width, height)};
}

/**
 * Reverses the per-scanline filters (PNG spec 9.2), each predicting from the pixel left (a), above
 * (b), and above-left (c).
 * @param {Buffer} raw - inflated scanlines, each prefixed by its filter type
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
function unfilter(raw, width, height) {
    const stride = width * BYTES_PER_PIXEL;
    const pixels = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        const rowStart = y * (stride + 1);
        const filter = raw[rowStart];
        for (let x = 0; x < stride; x++) {
            let a = 0;
            if (x >= BYTES_PER_PIXEL) {
                a = pixels[y * stride + x - BYTES_PER_PIXEL];
            }
            let b = 0;
            if (y > 0) {
                b = pixels[(y - 1) * stride + x];
            }
            let c = 0;
            if (x >= BYTES_PER_PIXEL && y > 0) {
                c = pixels[(y - 1) * stride + x - BYTES_PER_PIXEL];
            }
            pixels[y * stride + x] = (raw[rowStart + 1 + x] + predict(filter, a, b, c)) & 0xff;
        }
    }
    return pixels;
}

/**
 * @param {number} filter
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @returns {number} the byte the filter predicted
 */
function predict(filter, a, b, c) {
    if (filter === 0) {
        return 0;
    }
    if (filter === 1) {
        return a;
    }
    if (filter === 2) {
        return b;
    }
    if (filter === 3) {
        return Math.floor((a + b) / 2);
    }
    if (filter === 4) {
        return paeth(a, b, c);
    }
    throw new Error(`Unknown PNG filter type ${filter}`);
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @returns {number} whichever neighbor the Paeth predictor picks
 */
function paeth(a, b, c) {
    const estimate = a + b - c;
    const fromA = Math.abs(estimate - a);
    const fromB = Math.abs(estimate - b);
    const fromC = Math.abs(estimate - c);
    if (fromA <= fromB && fromA <= fromC) {
        return a;
    }
    if (fromB <= fromC) {
        return b;
    }
    return c;
}

/**
 * @param {string} path
 * @returns {number} the 0xRRGGBB pixel at the image's center, the part a 9-slice stretches
 */
export function centerPixel(path) {
    const {width, height, pixels} = decodePng(path);
    const offset = (Math.floor(height / 2) * width + Math.floor(width / 2)) * BYTES_PER_PIXEL;
    return (pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2];
}
