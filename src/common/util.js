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
 * Reads a compact JWT's `exp` claim without verifying its signature — only for a client-side
 * "is this still worth reusing" check; the server always re-verifies signature and expiry itself.
 * @param {string} token
 * @returns {number|null} the exp claim in epoch seconds, or null if unreadable
 */
export function jwtExpiry(token) {
    const parts = token.split(".");
    if (parts.length !== 3) {
        return null;
    }
    try {
        let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        base64 += "=".repeat((4 - base64.length % 4) % 4);
        const payload = JSON.parse(atob(base64));
        if (typeof payload.exp !== "number") {
            return null;
        }
        return payload.exp;
    } catch {
        return null;
    }
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

const MINUTES_PER_DAY = 24 * 60;

/**
 * Elapsed time since startedAtMs as "1day, 23h45m", day part omitted under one day.
 * @param {number} startedAtMs
 * @returns {string}
 */
export function formatUptime(startedAtMs) {
    const totalMinutes = Math.floor((Date.now() - startedAtMs) / 60_000);
    const days = Math.floor(totalMinutes / MINUTES_PER_DAY);
    const hours = Math.floor((totalMinutes % MINUTES_PER_DAY) / 60);
    const minutes = totalMinutes % 60;
    const clock = `${hours}h${String(minutes).padStart(2, "0")}m`;
    if (days === 0) {
        return clock;
    }
    return `${days}day, ${clock}`;
}

const DEFAULT_PORT_BY_SCHEME = {"ws:": "80", "wss:": "443"};

/**
 * A hand-typed server URL in canonical origin form (see {@link ORIGIN_PATTERN}): lowercase host
 * and an explicit port, filled in from the scheme when omitted.
 * @param {string} input - e.g. "wss://example.com"
 * @returns {string} the canonical origin, or "" if the input isn't a ws(s) origin
 */
export function canonicalOrigin(input) {
    let url;
    try {
        url = new URL(input.trim());
    } catch {
        return "";
    }
    const defaultPort = DEFAULT_PORT_BY_SCHEME[url.protocol];
    // Anything past the origin (path, query, credentials) would fork the server's identity.
    if (defaultPort === undefined || url.pathname !== "/" || url.search !== "" || url.hash !== ""
        || url.username !== "" || url.password !== "") {
        return "";
    }
    const port = url.port === "" ? defaultPort : url.port;
    return `${url.protocol}//${url.hostname}:${port}`;
}

/**
 * The HTTP(S) origin a game server's status endpoint is queried on, derived from its WS(S)
 * origin: same host:port, "ws"->"http" and "wss"->"https".
 * @param {string} wsOrigin - e.g. "wss://example.com:443"
 * @returns {string}
 */
export function httpOriginFor(wsOrigin) {
    return wsOrigin.replace(/^ws/, "http");
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
// Count brackets, widest magnitude first per unit; the last one absorbs everything above it.
const COUNT_UNITS = [
    {divisor: 1, suffix: "", limit: 99_999},
    {divisor: 1_000, suffix: "K", limit: 9_999_999},
    {divisor: 1_000_000, suffix: "M", limit: 999_999_999},
    {divisor: 1_000_000_000, suffix: "B", limit: Number.MAX_SAFE_INTEGER},
];

// The largest count the last unit still renders exactly; anything above it clamps.
const COUNT_MAX = 9_999 * 1_000_000_000;

/**
 * An unsigned integer count or currency amount as at most five characters (99999, 9999K, 999M, 1B).
 * @param {number} n
 * @returns {string}
 */
export function formatCount(n) {
    if (!Number.isInteger(n) || n < 0) {
        throw new RangeError(`Cannot format ${n} as a count: expected an unsigned integer`);
    }
    const count = Math.min(n, COUNT_MAX);
    for (const unit of COUNT_UNITS) {
        if (count <= unit.limit) {
            return `${Math.floor(count / unit.divisor)}${unit.suffix}`;
        }
    }
    throw new RangeError(`Cannot format ${n} as a count`);
}
