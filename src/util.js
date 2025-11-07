import {ChunkSize, Direction} from "@/backend/constants.js";

/**
 * @param arr {Array}
 * @param val
 */
export function removeFromArray(arr, val) {
    const index = arr.indexOf(val);
    arr.splice(index, 1);
}

export function fixNegativeZero(n) {
    return n === -0 ? 0 : n;
}

export function getChunk(x, y) {
    return `${Math.floor(x / ChunkSize)},${Math.floor(y / ChunkSize)}`;
}

/**
 * @param chunk {string}
 * @returns {{x: Number, y: Number}}
 */
export function getChunkCoords(chunk) {
    const [x, y] = chunk.split(",", 2);

    return {x: Number(x), y: Number(y)};
}


/**
 * @typedef Vec {Object}
 * @property direction {Direction}
 * @property x {number}
 * @property y {number}
 */

/**
 * @param point {Vec}
 * @param direction {Direction}
 * @returns {Vec}
 */
export function rotate(point, direction) {

    const newDirection = Direction.rotate(point.direction, direction);

    switch (direction) {
        case Direction.UP:
            return {x: point.x, y: point.y, direction: newDirection};
        case Direction.RIGHT:
            // noinspection JSSuspiciousNameCombination
            return {x: fixNegativeZero(-point.y), y: point.x, direction: newDirection};
        case Direction.DOWN:
            return {x: fixNegativeZero(-point.x), y: -point.y, direction: newDirection};
        case Direction.LEFT:
            // noinspection JSSuspiciousNameCombination
            return {x: point.y, y: fixNegativeZero(-point.x), direction: newDirection};
    }
}


/**
 * @param arr {Uint8Array}
 * @returns {Promise<Blob>}
 */
export async function gzipCompress(arr) {
    return await new Response(
        new Blob([arr]).stream().pipeThrough(new CompressionStream("gzip"))
      ).blob();
}

export function gzipDecompress(byteArray) {
    
}