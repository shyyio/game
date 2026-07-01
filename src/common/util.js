import {CHUNK_SIZE, REGION_SIZE, Direction} from "@/common/constants.js";

const REGION_HALF = REGION_SIZE / 2;

export function fixNegativeZero(n) {
    return n === -0 ? 0 : n;
}

/**
 * The ordinal id of the chunk containing tile (x, y): its index within the region,
 * counted left-to-right, top-to-bottom from the top-left chunk (id 0).
 * @param x {number} tile x
 * @param y {number} tile y
 * @returns {number}
 */
export function chunkId(x, y) {
    const chunkX = Math.floor(x / CHUNK_SIZE);
    const chunkY = Math.floor(y / CHUNK_SIZE);

    return (chunkY + REGION_HALF) * REGION_SIZE + (chunkX + REGION_HALF);
}

/**
 * Inverse of {@link chunkId}: the chunk coordinate (chunkX, chunkY) of a chunk id.
 * @param chunk {number}
 * @returns {{x: number, y: number}}
 */
export function chunkPosition(chunk) {
    return {
        x: chunk % REGION_SIZE - REGION_HALF,
        y: Math.floor(chunk / REGION_SIZE) - REGION_HALF,
    };
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