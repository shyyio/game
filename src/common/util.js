import {CHUNK_SIZE, Direction} from "@/common/constants.js";

export function fixNegativeZero(n) {
    return n === -0 ? 0 : n;
}

/**
 * Returns the "chunkX,chunkY" key string for the chunk containing tile (x, y).
 * @param x {number} tile x
 * @param y {number} tile y
 * @returns {string}
 */
export function chunkKey(x, y) {
    return `${Math.floor(x / CHUNK_SIZE)},${Math.floor(y / CHUNK_SIZE)}`;
}

/**
 * Inverse of {@link chunkKey}: parses a "chunkX,chunkY" key back into a chunk position.
 * @param chunk {string}
 * @returns {{x: Number, y: Number}}
 */
export function chunkPosition(chunk) {
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