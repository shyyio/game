import {Direction} from "@/sdk/common.js";
import {
    BELT_RAMP_DOWN,
    BELT_RAMP_UP,
    BELT_UNDERGROUND,
    MAX_UNDERGROUND_LENGTH,
} from "./constants.js";

/**
 * The surface (non-underground) belt record at a tile, or null.
 * @param {ViewportCache} beltCache
 * @param {number} tileX
 * @param {number} tileY
 * @returns {object|null}
 */
export function surfaceBeltAt(beltCache, tileX, tileY) {
    const records = beltCache.getAtTile(tileX, tileY);
    const surface = records.find(record => record.data.type !== BELT_UNDERGROUND);
    return surface === undefined ? null : surface;
}

/**
 * Walks `ramp`'s tunnel along its axis, returning the buried tiles passed and the
 * paired opposite ramp record (or null for a lone ramp).
 * @param {ViewportCache} beltCache
 * @param {object} ramp
 * @returns {{tiles: {x: number, y: number}[], pair: object|null}}
 */
export function walkTunnel(beltCache, ramp) {
    const {dx, dy} = tunnelStep(ramp.data.type, ramp.data.direction);
    const pairType = ramp.data.type === BELT_RAMP_UP ? BELT_RAMP_DOWN : BELT_RAMP_UP;

    let x = ramp.tileX;
    let y = ramp.tileY;
    const tiles = [];
    for (let i = 0; i < MAX_UNDERGROUND_LENGTH + 1; i += 1) {
        x += dx;
        y += dy;
        const records = beltCache.getAtTile(x, y);
        // Match this tunnel's own underground, not a crossing one sharing the tile:
        // a tunnel's undergrounds face the same direction as its ramps.
        const underground = records.find(record =>
            record.data.type === BELT_UNDERGROUND && record.data.direction === ramp.data.direction
        );
        if (underground !== undefined) {
            tiles.push({x, y});
            continue;
        }
        const pair = records.find(record =>
            record.data.type === pairType && record.data.direction === ramp.data.direction
        );
        return {tiles, pair: pair === undefined ? null : pair};
    }
    return {tiles, pair: null};
}

// ---- Underground belt helpers ----

/**
 * The per-step (dx, dy) for walking a ramp's tunnel (a RAMP_UP steps against its facing, a RAMP_DOWN along it).
 * @param {number} rampType BELT_RAMP_UP or BELT_RAMP_DOWN
 * @param {Direction} direction the ramp's facing
 * @returns {{dx: number, dy: number}}
 */
export function tunnelStep(rampType, direction) {
    const sign = rampType === BELT_RAMP_UP ? -1 : 1;
    return {dx: sign * Direction.dx(direction), dy: sign * Direction.dy(direction)};
}

/**
 * @param rampParent {{x: number, y: number, type: number, direction: Direction}}
 * @param options {{x: number, y: number, type: number, direction: Direction}}
 * @returns {{x: number, y: number}[]}
 */
export function getUndergroundBeltsToCreate(rampParent, options) {
    if (rampParent === null || rampParent.direction !== options.direction
        || (rampParent.type !== BELT_RAMP_DOWN && rampParent.type !== BELT_RAMP_UP)
        || (rampParent.x !== options.x && rampParent.y !== options.y)) {
        throw new Error("Invalid ramp parent for underground belt creation");
    }

    const x1 = rampParent.type === BELT_RAMP_UP ? options.x : rampParent.x;
    const y1 = rampParent.type === BELT_RAMP_UP ? options.y : rampParent.y;
    let x2 = rampParent.type === BELT_RAMP_UP ? rampParent.x : options.x;
    let y2 = rampParent.type === BELT_RAMP_UP ? rampParent.y : options.y;

    const dx = x2 === x1 ? 0 : x2 < x1 ? -1 : 1;
    const dy = y2 === y1 ? 0 : y2 < y1 ? -1 : 1;

    x2 -= dx;
    y2 -= dy;

    let x = x1;
    let y = y1;

    const undergrounds = [];
    while (x !== x2 || y !== y2) {
        x += dx;
        y += dy;
        undergrounds.push({x, y});
    }

    if (undergrounds.length > MAX_UNDERGROUND_LENGTH) {
        return [];
    }

    return undergrounds;
}
