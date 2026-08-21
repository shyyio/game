// Pure RGBA buffer operations for the sprite editor; every op paints `block`-sized squares so
// the 2x-upscaled atlas can be edited as 1x source art.

/**
 * @typedef {{width: number, height: number, data: Uint8ClampedArray}} PixelBuffer
 */

/**
 * @param {PixelBuffer} buffer
 * @param {number} x
 * @param {number} y
 * @returns {number[]} [r, g, b, a]
 */
export function getPixel(buffer, x, y) {
    const i = (y * buffer.width + x) * 4;
    return [buffer.data[i], buffer.data[i + 1], buffer.data[i + 2], buffer.data[i + 3]];
}

/**
 * Fills the `block`-aligned square containing (x, y).
 * @param {PixelBuffer} buffer
 * @param {number} x
 * @param {number} y
 * @param {number[]} rgba
 * @param {number} block
 * @returns {void}
 */
export function setBlock(buffer, x, y, rgba, block) {
    const x0 = x - (x % block);
    const y0 = y - (y % block);
    for (let py = y0; py < Math.min(y0 + block, buffer.height); py++) {
        for (let px = x0; px < Math.min(x0 + block, buffer.width); px++) {
            const i = (py * buffer.width + px) * 4;
            buffer.data[i] = rgba[0];
            buffer.data[i + 1] = rgba[1];
            buffer.data[i + 2] = rgba[2];
            buffer.data[i + 3] = rgba[3];
        }
    }
}

/**
 * Bresenham line of blocks from (x0, y0) to (x1, y1).
 * @param {PixelBuffer} buffer
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number[]} rgba
 * @param {number} block
 * @returns {void}
 */
export function drawLine(buffer, x0, y0, x1, y1, rgba, block) {
    // Walk in block units so diagonal steps never skip a block.
    let bx0 = Math.floor(x0 / block);
    let by0 = Math.floor(y0 / block);
    const bx1 = Math.floor(x1 / block);
    const by1 = Math.floor(y1 / block);
    const dx = Math.abs(bx1 - bx0);
    const dy = -Math.abs(by1 - by0);
    const sx = bx0 < bx1 ? 1 : -1;
    const sy = by0 < by1 ? 1 : -1;
    let error = dx + dy;
    for (;;) {
        if (bx0 >= 0 && by0 >= 0 && bx0 * block < buffer.width && by0 * block < buffer.height) {
            setBlock(buffer, bx0 * block, by0 * block, rgba, block);
        }
        if (bx0 === bx1 && by0 === by1) {
            break;
        }
        const e2 = 2 * error;
        if (e2 >= dy) {
            error += dy;
            bx0 += sx;
        }
        if (e2 <= dx) {
            error += dx;
            by0 += sy;
        }
    }
}

/**
 * Outline rectangle of blocks with corners at (x0, y0) and (x1, y1).
 * @param {PixelBuffer} buffer
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number[]} rgba
 * @param {number} block
 * @returns {void}
 */
export function drawRect(buffer, x0, y0, x1, y1, rgba, block) {
    drawLine(buffer, x0, y0, x1, y0, rgba, block);
    drawLine(buffer, x1, y0, x1, y1, rgba, block);
    drawLine(buffer, x1, y1, x0, y1, rgba, block);
    drawLine(buffer, x0, y1, x0, y0, rgba, block);
}

/**
 * 4-connected flood fill in block units from (x, y), replacing the color found there.
 * @param {PixelBuffer} buffer
 * @param {number} x
 * @param {number} y
 * @param {number[]} rgba
 * @param {number} block
 * @returns {void}
 */
export function floodFill(buffer, x, y, rgba, block) {
    const target = getPixel(buffer, x, y);
    if (sameColor(target, rgba)) {
        return;
    }
    const columns = Math.ceil(buffer.width / block);
    const rows = Math.ceil(buffer.height / block);
    const stack = [[Math.floor(x / block), Math.floor(y / block)]];
    const seen = new Uint8Array(columns * rows);
    while (stack.length > 0) {
        const [bx, by] = stack.pop();
        if (bx < 0 || by < 0 || bx >= columns || by >= rows || seen[by * columns + bx] === 1) {
            continue;
        }
        seen[by * columns + bx] = 1;
        if (!sameColor(getPixel(buffer, bx * block, by * block), target)) {
            continue;
        }
        setBlock(buffer, bx * block, by * block, rgba, block);
        stack.push([bx + 1, by], [bx - 1, by], [bx, by + 1], [bx, by - 1]);
    }
}

/**
 * @param {number[]} a
 * @param {number[]} b
 * @returns {boolean}
 */
export function sameColor(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/**
 * Distinct opaque-or-not colors by frequency, most common first.
 * @param {PixelBuffer} buffer
 * @param {number} limit
 * @returns {number[][]}
 */
export function paletteOf(buffer, limit) {
    const counts = new Map();
    for (let i = 0; i < buffer.data.length; i += 4) {
        if (buffer.data[i + 3] === 0) {
            continue;
        }
        const key = (buffer.data[i] << 24 | buffer.data[i + 1] << 16 | buffer.data[i + 2] << 8 | buffer.data[i + 3]) >>> 0;
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    return sorted.map(([key]) => [key >>> 24, key >>> 16 & 255, key >>> 8 & 255, key & 255]);
}

/**
 * @param {number[]} rgba
 * @returns {string} "#rrggbb"
 */
export function toHex(rgba) {
    return "#" + rgba.slice(0, 3).map(v => v.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {string} hex "#rrggbb"
 * @param {number} alpha 0-255
 * @returns {number[]}
 */
export function fromHex(hex, alpha) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), alpha];
}
