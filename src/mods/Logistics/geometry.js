import {Direction, OCCUPANCY_LAYER_SURFACE} from "@/sdk/common.js";
import {BeltDefinition} from "./definitions.js";
import {
    BeltType,
    BELT_RAMP_DOWN,
    BELT_RAMP_UP,
    BELT_UNDERGROUND,
    MAX_UNDERGROUND_LENGTH,
    OCCUPANCY_LAYER_UNDERGROUND_BASE,
} from "./constants.js";

/**
 * Whether a feeder feeds forward on the surface: ramp entrances/undergrounds share the belt's
 * forward output port but bury the flow, so exclude them; any non-belt object feeds forward.
 * @param {object} data - a feeder record's data
 * @returns {boolean}
 */
function feedsForward(data) {
    if (data.definition === BeltDefinition) {
        return data.type === BeltType.NORMAL || data.type === BeltType.RAMP_UP;
    }
    return true;
}

/**
 * The tile a belt at (tileX, tileY) facing `direction` is fed from (via the cache's port-connection
 * query, so any object's output landing here counts), or {parentX: null, parentY: null}. The
 * highest-id feeder that feeds forward wins, mirroring the server's upstreamParentSql.
 * @param {ClientCache} cache
 * @param {number} tileX
 * @param {number} tileY
 * @param {Direction} direction
 * @returns {{parentX: number|null, parentY: number|null}}
 */
export function inferBeltParent(cache, tileX, tileY, direction) {
    const belt = {tileX, tileY, data: {definition: BeltDefinition, direction}};

    let parent = null;
    cache.connectedPorts(belt).forEach(connection => {
        if (connection.isOutput || !feedsForward(connection.neighbor.data)) {
            return;
        }
        if (parent === null || connection.neighbor.id > parent.neighbor.id) {
            parent = connection;
        }
    });

    if (parent === null) {
        return {parentX: null, parentY: null};
    }
    return {parentX: parent.neighborX, parentY: parent.neighborY};
}

/**
 * The occupancy layer a belt of `type` facing `direction` sits on: undergrounds get one
 * layer per axis (so crossing tunnels and a surface belt coexist), everything else SURFACE.
 * @param {BeltType} type
 * @param {Direction} direction
 * @returns {number}
 */
export function beltOccupancyLayer(type, direction) {
    if (type === BELT_UNDERGROUND) {
        return OCCUPANCY_LAYER_UNDERGROUND_BASE + (direction % 2);
    }
    return OCCUPANCY_LAYER_SURFACE;
}

/**
 * The surface (non-underground) belt entry at a tile, or null. Other object kinds (splitters)
 * sharing the index are ignored.
 * @param {ClientCache} index
 * @param {number} tileX
 * @param {number} tileY
 * @returns {CacheEntry|null}
 */
export function surfaceBeltAt(index, tileX, tileY) {
    const entries = index.getAtTile(tileX, tileY);
    const surface = entries.find(record =>
        record.data.definition === BeltDefinition && record.data.type !== BELT_UNDERGROUND);
    return surface === undefined ? null : surface;
}

/**
 * Walks `ramp`'s tunnel along its axis, returning the buried tiles passed and the
 * paired opposite ramp entry (or null for a lone ramp).
 * @param {ClientCache} index
 * @param {CacheEntry} ramp
 * @returns {{tiles: {x: number, y: number}[], pair: CacheEntry|null}}
 */
export function walkTunnel(index, ramp) {
    const {dx, dy} = tunnelStep(ramp.data.type, ramp.data.direction);
    const pairType = ramp.data.type === BELT_RAMP_UP ? BELT_RAMP_DOWN : BELT_RAMP_UP;

    let x = ramp.tileX;
    let y = ramp.tileY;
    const tiles = [];
    for (let i = 0; i < MAX_UNDERGROUND_LENGTH + 1; i += 1) {
        x += dx;
        y += dy;
        const records = index.getAtTile(x, y);
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
 * Whether a belt type is a ramp entrance or exit.
 * @param {number} type
 * @returns {boolean}
 */
export function isRamp(type) {
    return type === BELT_RAMP_UP || type === BELT_RAMP_DOWN;
}

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
        || !isRamp(rampParent.type)
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
