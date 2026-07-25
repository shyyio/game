import {Direction} from "@/sdk/common.js";
import {BeltDefinition, isBeltType} from "./objectTypes.js";
import {
    BELT_NORMAL,
    BELT_RAMP_UP,
    BELT_RAMP_DOWN,
    BELT_UNDERGROUND,
    MAX_UNDERGROUND_LENGTH,
    tunnelStep,
} from "./constants.js";

/**
 * Whether a feeder feeds forward on the surface: ramp entrances/undergrounds bury the flow, any non-belt feeds forward.
 * @param {object} data - a feeder record's data
 * @returns {boolean}
 */
function feedsForward(data) {
    if (isBeltType(data.type)) {
        return data.type.beltKind === BELT_NORMAL || data.type.beltKind === BELT_RAMP_UP;
    }
    return true;
}

/**
 * The tile a belt at (tileX, tileY) facing `direction` is fed from, or nulls; the highest-id
 * forward feeder wins, mirroring Belts._chosenUpstream.
 * @param {ClientCache} cache
 * @param {number} tileX
 * @param {number} tileY
 * @param {Direction} direction
 * @returns {{parentX: number|null, parentY: number|null}}
 */
export function inferBeltParent(cache, tileX, tileY, direction) {
    // Stand-in record with a normal belt's ports for the port-connection query.
    const belt = {tileX, tileY, data: {type: BeltDefinition, direction}};

    let parent = null;
    for (const connection of cache.connectedPorts(belt)) {
        if (connection.isOutput || !feedsForward(connection.neighbor.data)) {
            continue;
        }
        if (parent === null || connection.neighbor.id > parent.neighbor.id) {
            parent = connection;
        }
    }

    if (parent === null) {
        return {parentX: null, parentY: null};
    }
    return {parentX: parent.neighborX, parentY: parent.neighborY};
}

/**
 * The surface (non-underground) belt entry at a tile, or null.
 * @param {ClientCache} index
 * @param {number} tileX
 * @param {number} tileY
 * @returns {CacheEntry|null}
 */
export function surfaceBeltAt(index, tileX, tileY) {
    const entries = index.getAtTile(tileX, tileY);
    const surface = entries.find(record =>
        isBeltType(record.data.type) && record.data.type.beltKind !== BELT_UNDERGROUND);
    if (surface === undefined) {
        return null;
    }
    return surface;
}

/**
 * Walks `ramp`'s tunnel along its axis, returning the buried tiles and the paired opposite ramp (or null).
 * @param {ClientCache} index
 * @param {CacheEntry} ramp
 * @returns {{tiles: {x: number, y: number}[], pair: CacheEntry|null}}
 */
export function walkTunnel(index, ramp) {
    const {dx, dy} = tunnelStep(ramp.data.type.beltKind, ramp.data.direction);
    const pairType = ramp.data.type.beltKind === BELT_RAMP_UP ? BELT_RAMP_DOWN : BELT_RAMP_UP;

    let x = ramp.tileX;
    let y = ramp.tileY;
    const tiles = [];
    for (let i = 0; i < MAX_UNDERGROUND_LENGTH + 1; i += 1) {
        x += dx;
        y += dy;
        const records = index.getAtTile(x, y);
        // A tunnel's undergrounds face its ramps' direction, so skip a crossing tunnel's.
        const underground = records.find(record =>
            record.data.type.beltKind === BELT_UNDERGROUND && record.data.direction === ramp.data.direction
        );
        if (underground !== undefined) {
            tiles.push({x, y});
            continue;
        }
        const pair = records.find(record =>
            record.data.type.beltKind === pairType && record.data.direction === ramp.data.direction
        );
        if (pair === undefined) {
            return {tiles, pair: null};
        }
        return {tiles, pair};
    }
    return {tiles, pair: null};
}

// ---- Underground belt helpers ----

/**
 * Whether a belt type is a ramp entrance or exit.
 * @param {number} type
 * @returns {boolean}
 */
export function isRamp(type) {
    return type === BELT_RAMP_UP || type === BELT_RAMP_DOWN;
}

/**
 * Scans from (x, y) along a `kind` ramp's tunnel axis for its partner ramp; a same-kind ramp in
 * between blocks the pairing. Shared by the sim (`Belts.rampPartner`) and the client tool
 * (`UndergroundBeltTool`), each supplying its own belt lookup.
 * @param {number} x
 * @param {number} y
 * @param {Direction} direction
 * @param {BeltType} kind - BELT_RAMP_DOWN or BELT_RAMP_UP
 * @param {function(number, number): {type: BeltType, direction: Direction}[]} beltsAt - candidates on a tile
 * @returns {object|null} the matched partner-kind belt (whatever shape `beltsAt` returns), or null
 */
export function findRampPartner(x, y, direction, kind, beltsAt) {
    const {dx, dy} = tunnelStep(kind, direction);
    const partnerKind = kind === BELT_RAMP_UP ? BELT_RAMP_DOWN : BELT_RAMP_UP;
    let cx = x;
    let cy = y;
    for (let i = 1; i < MAX_UNDERGROUND_LENGTH + 2; i += 1) {
        cx += dx;
        cy += dy;
        for (const belt of beltsAt(cx, cy)) {
            if (belt.type === kind) {
                return null;
            }
            if (belt.type === partnerKind && belt.direction === direction) {
                return belt;
            }
        }
    }
    return null;
}

/**
 * @param rampParent {{x: number, y: number, type: number, direction: Direction}}
 * @param options {{x: number, y: number, type: number, direction: Direction}}
 * @returns {{x: number, y: number}[]}
 */
export function getUndergroundBeltsToCreate(rampParent, options) {
    if (rampParent === null || rampParent.direction !== options.direction
        || !isRamp(rampParent.type)
        || (rampParent.x !== options.x && rampParent.y !== options.y)) {
        throw new Error("Invalid ramp parent for underground belt creation");
    }

    const x1 = rampParent.type === BELT_RAMP_UP ? options.x : rampParent.x;
    const y1 = rampParent.type === BELT_RAMP_UP ? options.y : rampParent.y;
    let x2 = rampParent.type === BELT_RAMP_UP ? rampParent.x : options.x;
    let y2 = rampParent.type === BELT_RAMP_UP ? rampParent.y : options.y;

    let dx = 0;
    if (x2 !== x1) {
        if (x2 < x1) {
            dx = -1;
        } else {
            dx = 1;
        }
    }
    let dy = 0;
    if (y2 !== y1) {
        if (y2 < y1) {
            dy = -1;
        } else {
            dy = 1;
        }
    }

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
