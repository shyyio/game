import {CHUNK_SIZE, NEIGHBOR_DELTAS, REGION_SIZE, Direction} from "@/common/constants.js";
import {DEV} from "@/common/env.js";

export const REGION_HALF = REGION_SIZE / 2;

// How many variants a tile id may be qualified with (a position layer, a direction).
export const TILE_VARIANT_LIMIT = 16;

// The box the spatial indexes address, in tiles: the whole region, so coordinates fall in
// [-TILE_SPAN/2, TILE_SPAN/2).
const TILE_SPAN = CHUNK_SIZE * REGION_SIZE;
export const TILE_HALF = TILE_SPAN / 2;

// A qualified tile id must stay a small integer, or every Map keyed by one hashes a boxed number
// instead. Growing the region past this needs the indexes rekeyed, not a wider id.
const MAX_SMALL_INTEGER = 2 ** 31;
if (TILE_SPAN * TILE_SPAN * TILE_VARIANT_LIMIT >= MAX_SMALL_INTEGER) {
    throw new RangeError(`A ${TILE_SPAN}x${TILE_SPAN} tile box does not fit a small-integer tile id`);
}

export function fixNegativeZero(n) {
    if (Object.is(n, -0)) {
        return 0;
    }
    return n;
}

/**
 * The ordinal id of a chunk from its chunk coordinate: its index within the region,
 * counted left-to-right, top-to-bottom from the top-left chunk (id 0).
 * @param chunkX {number}
 * @param chunkY {number}
 * @returns {number}
 */
export function chunkOrdinal(chunkX, chunkY) {
    return (chunkY + REGION_HALF) * REGION_SIZE + (chunkX + REGION_HALF);
}

/**
 * The ordinal id of the chunk containing tile (x, y).
 * @param x {number} tile x
 * @param y {number} tile y
 * @returns {number}
 */
export function chunkId(x, y) {
    return chunkOrdinal(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
}

/**
 * The id of tile (x, y): its index in the world grid, counted left-to-right, top-to-bottom. The
 * spatial indexes key on this rather than on an "x,y" string — a tile lookup then costs no string
 * to build and no string to keep.
 * @param x {number} tile x
 * @param y {number} tile y
 * @returns {number}
 */
export function tileId(x, y) {
    // Called per spatial lookup, so the bounds check is dev-only: out of the box it returns a
    // colliding id rather than throwing.
    if (DEV && (x < -TILE_HALF || x >= TILE_HALF || y < -TILE_HALF || y >= TILE_HALF)) {
        throw new RangeError(`Tile (${x}, ${y}) is outside the ${TILE_SPAN}x${TILE_SPAN} tile box`);
    }
    return (y + TILE_HALF) * TILE_SPAN + (x + TILE_HALF);
}

/**
 * A tile id qualified by `variant` (a position layer, a direction), so one index can hold several
 * entries per tile.
 * @param tile {number} a {@link tileId}
 * @param variant {number} below {@link TILE_VARIANT_LIMIT}
 * @returns {number}
 */
export function tileVariantId(tile, variant) {
    return tile * TILE_VARIANT_LIMIT + variant;
}

/**
 * Whether chunk coordinate (chunkX, chunkY) lies inside the region.
 * @param chunkX {number}
 * @param chunkY {number}
 * @returns {boolean}
 */
export function inRegion(chunkX, chunkY) {
    return chunkX >= -REGION_HALF && chunkX < REGION_HALF && chunkY >= -REGION_HALF && chunkY < REGION_HALF;
}

/**
 * The chunk's edge neighbors, clipped to the region.
 * @param chunk {number}
 * @returns {number[]}
 */
export function chunkNeighbors(chunk) {
    const position = chunkPosition(chunk);
    const neighbors = [];
    for (const delta of NEIGHBOR_DELTAS) {
        const x = position.x + delta.dx;
        const y = position.y + delta.dy;
        if (inRegion(x, y)) {
            neighbors.push(chunkOrdinal(x, y));
        }
    }
    return neighbors;
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
 * The tile position of a chunk's top-left corner, the origin chunk-relative tile coordinates count
 * from.
 * @param chunk {number}
 * @returns {{x: number, y: number}}
 */
export function chunkOrigin(chunk) {
    const position = chunkPosition(chunk);
    return {x: position.x * CHUNK_SIZE, y: position.y * CHUNK_SIZE};
}

/**
 * The tile position of a chunk's center.
 * @param chunk {number}
 * @returns {{x: number, y: number}}
 */
export function chunkCenter(chunk) {
    const origin = chunkOrigin(chunk);
    return {x: origin.x + CHUNK_SIZE / 2, y: origin.y + CHUNK_SIZE / 2};
}


/**
 * The fallback display name for a player id with no registered username; the sim's ensure() and
 * the client's directory fallback share it so they never drift.
 * @param {number} playerId
 * @returns {string}
 */
export function syntheticUsername(playerId) {
    return `player${playerId}`;
}

/**
 * A byte count as short human-readable text (472B, 12KB, 1.3MB).
 * @param {number} n
 * @returns {string}
 */
export function formatBytes(n) {
    if (n >= 1024 * 1024) {
        return `${(n / (1024 * 1024)).toFixed(1)}MB`;
    }
    if (n >= 1024) {
        return `${Math.round(n / 1024)}KB`;
    }
    return `${n}B`;
}

/**
 * The map's value under a key, created and stored on first use.
 * @param map {Map}
 * @param key {*}
 * @param create {function(): *}
 * @returns {*}
 */
export function getOrCreate(map, key, create) {
    let value = map.get(key);
    if (value === undefined) {
        value = create();
        map.set(key, value);
    }
    return value;
}

/**
 * Drops `member` from the Set at `key`, deleting the key once its set empties; pairs with
 * `getOrCreate(map, key, () => new Set())` for the add side.
 * @param map {Map<*, Set>}
 * @param key {*}
 * @param member {*}
 * @returns {void}
 */
export function removeFromGroup(map, key, member) {
    const group = map.get(key);
    if (group === undefined) {
        return;
    }
    group.delete(member);
    if (group.size === 0) {
        map.delete(key);
    }
}

/**
 * The 4-neighborhood tiles of every cell, with duplicates where neighborhoods overlap.
 * @param {{x: number, y: number}[]} cells
 * @returns {IterableIterator<{x: number, y: number}>}
 */
export function* cellNeighbors(cells) {
    for (const cell of cells) {
        for (const delta of NEIGHBOR_DELTAS) {
            yield {x: cell.x + delta.dx, y: cell.y + delta.dy};
        }
    }
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