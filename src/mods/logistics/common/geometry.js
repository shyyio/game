import {Direction} from "@spup/sdk";
import {BeltType, isBeltType} from "./objectTypes.js";
import {
    BELT_NORMAL,
    BELT_TUNNEL_UP,
    BELT_TUNNEL_DOWN,
    BELT_UNDERGROUND,
    MAX_UNDERGROUND_LENGTH,
    tunnelStep,
} from "./constants.js";

/**
 * The tile a belt is fed from; both null when nothing feeds it.
 * @typedef {Object} ParentTile
 * @property {number|null} parentX
 * @property {number|null} parentY
 */

/**
 * @typedef {Object} TunnelWalk
 * @property {Point[]} tiles the underground tiles walked
 * @property {CacheEntry|null} pair the mouth the walk ended on
 */

/**
 * Whether a feeder feeds forward on the surface: tunnel entrances/undergrounds bury the flow, any non-belt feeds forward.
 * @param {object} data - a feeder entry's data
 * @returns {boolean}
 */
function isFeedingForward(data) {
    if (isBeltType(data.type)) {
        return data.type.beltKind === BELT_NORMAL || data.type.beltKind === BELT_TUNNEL_UP;
    }
    return true;
}

/**
 * The tile a belt at (tileX, tileY) facing `direction` is fed from, or nulls; the highest-id
 * forward feeder wins, the rule the lane rebuild applies.
 * @param {ObjectsView} cache
 * @param {number} tileX
 * @param {number} tileY
 * @param {Direction} direction
 * @returns {ParentTile}
 */
export function inferBeltParent(cache, tileX, tileY, direction) {
    // Stand-in entry with a normal belt's ports for the port-connection query.
    const belt = {tileX, tileY, data: {type: BeltType, direction}};

    let parent = null;
    for (const connection of cache.connectedPorts(belt)) {
        if (connection.isOutput || !isFeedingForward(connection.neighbor.data)) {
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
 * @param {ObjectsView} index
 * @param {number} tileX
 * @param {number} tileY
 * @returns {CacheEntry|null}
 */
export function surfaceBeltAt(index, tileX, tileY) {
    const entries = index.getAtTile(tileX, tileY);
    const surface = entries.find(entry =>
        isBeltType(entry.data.type) && entry.data.type.beltKind !== BELT_UNDERGROUND);
    if (surface === undefined) {
        return null;
    }
    return surface;
}

/**
 * Walks `mouth`'s tunnel along its axis, returning the buried tiles and the paired opposite mouth (or null).
 * @param {ObjectsView} index
 * @param {CacheEntry} mouth
 * @returns {TunnelWalk}
 */
export function walkTunnel(index, mouth) {
    const {dx, dy} = tunnelStep(mouth.data.type.beltKind, mouth.data.direction);
    const pairType = mouth.data.type.beltKind === BELT_TUNNEL_UP ? BELT_TUNNEL_DOWN : BELT_TUNNEL_UP;

    let x = mouth.tileX;
    let y = mouth.tileY;
    const tiles = [];
    for (let i = 0; i < MAX_UNDERGROUND_LENGTH + 1; i += 1) {
        x += dx;
        y += dy;
        const entries = index.getAtTile(x, y);
        // A tunnel's undergrounds face its mouths' direction, so skip a crossing tunnel's.
        const underground = entries.find(entry =>
            entry.data.type.beltKind === BELT_UNDERGROUND && entry.data.direction === mouth.data.direction
        );
        if (underground !== undefined) {
            tiles.push({x, y});
            continue;
        }
        const pair = entries.find(entry =>
            entry.data.type.beltKind === pairType && entry.data.direction === mouth.data.direction
        );
        if (pair === undefined) {
            return {tiles, pair: null};
        }
        return {tiles, pair};
    }
    return {tiles, pair: null};
}

/**
 * Whether a belt type is a tunnel entrance or exit.
 * @param {number} type
 * @returns {boolean}
 */
export function isTunnelMouth(type) {
    return type === BELT_TUNNEL_UP || type === BELT_TUNNEL_DOWN;
}

/**
 * Scans from (x, y) along a `kind` mouth's tunnel axis for its partner mouth; a same-kind mouth in
 * between blocks the pairing. Shared by the sim (`BeltBehavior`) and the client tool
 * (`UndergroundBeltTool`), each supplying its own belt lookup.
 * @param {number} x
 * @param {number} y
 * @param {Direction} direction
 * @param {BeltType} kind - BELT_TUNNEL_DOWN or BELT_TUNNEL_UP
 * @param {function(number, number): {type: BeltType, direction: Direction}[]} beltsAt - candidates on a tile
 * @returns {object|null} the matched partner-kind belt (whatever shape `beltsAt` returns), or null
 */
export function findTunnelPartner(x, y, direction, kind, beltsAt) {
    const {dx, dy} = tunnelStep(kind, direction);
    const partnerKind = kind === BELT_TUNNEL_UP ? BELT_TUNNEL_DOWN : BELT_TUNNEL_UP;
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
 * @param {{x: number, y: number, type: number, direction: Direction} tunnelParent}
 * @param {{x: number, y: number, type: number, direction: Direction} options}
 * @returns {Point[]}
 */
export function getUndergroundBeltsToCreate(tunnelParent, options) {
    if (tunnelParent === null || tunnelParent.direction !== options.direction
        || !isTunnelMouth(tunnelParent.type)
        || (tunnelParent.x !== options.x && tunnelParent.y !== options.y)) {
        throw new Error("Invalid tunnel parent for underground belt creation");
    }

    const x1 = tunnelParent.type === BELT_TUNNEL_UP ? options.x : tunnelParent.x;
    const y1 = tunnelParent.type === BELT_TUNNEL_UP ? options.y : tunnelParent.y;
    let x2 = tunnelParent.type === BELT_TUNNEL_UP ? tunnelParent.x : options.x;
    let y2 = tunnelParent.type === BELT_TUNNEL_UP ? tunnelParent.y : options.y;

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
