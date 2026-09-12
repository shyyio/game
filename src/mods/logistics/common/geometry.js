import {Direction, LANE_LEVEL_SURFACE} from "@spup/sdk";
import {BeltType, isBeltType} from "./objectTypes.js";
import {
    BELT_NORMAL,
    BELT_TUNNEL_UP,
    BELT_TUNNEL_DOWN,
    BELT_UNDERGROUND,
    getBeltKindEntryByKind,
    getBuildLevelByBeltKind,
    MAX_UNDERGROUND_LENGTH,
    tunnelStep,
} from "./constants.js";

/**
 * The tile of a belt's parent; both null when it has none.
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
 * Whether a candidate parents the tile ahead on the surface: tunnel entrances/undergrounds bury the
 * flow, any non-belt hands it forward.
 * @param {object} data - a candidate entry's data
 * @returns {boolean}
 */
function isParentingForward(data) {
    if (isBeltType(data.type)) {
        return data.type.beltKind === BELT_NORMAL || data.type.beltKind === BELT_TUNNEL_UP;
    }
    return true;
}

/**
 * The parent tile of a belt at (tileX, tileY) facing `direction`, or nulls; the highest-id forward
 * candidate wins, the rule the lane rebuild applies.
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
        if (connection.isOutput || !isParentingForward(connection.neighbor.data)) {
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
 * An elevated belt's parent tile and the level it hands flow on at; all three null/surface when it
 * has no parent.
 * @typedef {Object} ElevatedParentTile
 * @property {number|null} parentX
 * @property {number|null} parentY
 * @property {LaneLevel} parentLevel
 */

/**
 * The parent tile of an elevated belt at (tileX, tileY) facing `direction`, or nulls. A parent is
 * any belt pointing into the tile that hands its flow on above the surface, a ramp included; the
 * highest-id one wins, the rule the lane rebuild applies.
 * @param {ObjectsView} cache
 * @param {number} tileX
 * @param {number} tileY
 * @param {Direction} direction
 * @returns {ElevatedParentTile}
 */
export function inferElevatedBeltParent(cache, tileX, tileY, direction) {
    let parent = null;
    // A parent facing `parentDirection` stands one tile back along it; the cell ahead pointing back
    // head-on meets no input port, so that facing is skipped.
    for (let parentDirection = 0; parentDirection < 4; parentDirection += 1) {
        if (parentDirection === Direction.invert(direction)) {
            continue;
        }
        const candidateX = tileX - Direction.dx(parentDirection);
        const candidateY = tileY - Direction.dy(parentDirection);
        for (const entry of cache.getAtTile(candidateX, candidateY)) {
            if (!isBeltType(entry.data.type) || entry.data.direction !== parentDirection) {
                continue;
            }
            if (entry.data.type.behavior.outLevel <= LANE_LEVEL_SURFACE) {
                continue;
            }
            if (parent === null || entry.id > parent.id) {
                parent = entry;
            }
        }
    }
    if (parent === null) {
        return {parentX: null, parentY: null, parentLevel: LANE_LEVEL_SURFACE};
    }
    return {parentX: parent.tileX, parentY: parent.tileY, parentLevel: parent.data.type.behavior.outLevel};
}

/**
 * Whether a belt facing `beltDirection` takes flow at `level` from a parent facing
 * `parentDirection`; a non-merging kind takes only its straight input.
 * @param {BeltType} kind
 * @param {Direction} beltDirection
 * @param {Direction} parentDirection
 * @param {LaneLevel} level
 * @returns {boolean}
 */
function isTakingFlowAtLevel(kind, beltDirection, parentDirection, level) {
    const entry = getBeltKindEntryByKind(kind);
    if (entry.inLevel !== level) {
        return false;
    }
    if (!entry.isMerging) {
        return beltDirection === parentDirection;
    }
    return beltDirection !== Direction.invert(parentDirection);
}

/**
 * Whether an elevated belt at (tileX, tileY) facing `direction` would join a run at `level`: it has
 * a parent handing flow on at that level, or the cell ahead takes it as one. Shared by the sim
 * (`BeltBehavior`) and the client tool (`BeltTool`), each supplying its own belt lookup.
 * @param {number} tileX
 * @param {number} tileY
 * @param {Direction} direction
 * @param {LaneLevel} level
 * @param {function(number, number): {type: BeltType, direction: Direction}[]} beltsAt - candidates on a tile
 * @returns {boolean}
 */
export function isElevatedBeltConnected(tileX, tileY, direction, level, beltsAt) {
    // A parent facing `parentDirection` stands one tile back along it; the cell ahead pointing back
    // head-on meets no input port, so that facing is skipped.
    for (let parentDirection = 0; parentDirection < 4; parentDirection += 1) {
        if (parentDirection === Direction.invert(direction)) {
            continue;
        }
        const candidateX = tileX - Direction.dx(parentDirection);
        const candidateY = tileY - Direction.dy(parentDirection);
        for (const belt of beltsAt(candidateX, candidateY)) {
            if (belt.direction === parentDirection && getBeltKindEntryByKind(belt.type).outLevel === level) {
                return true;
            }
        }
    }
    const aheadX = tileX + Direction.dx(direction);
    const aheadY = tileY + Direction.dy(direction);
    for (const belt of beltsAt(aheadX, aheadY)) {
        if (isTakingFlowAtLevel(belt.type, belt.direction, direction, level)) {
            return true;
        }
    }
    return false;
}

/**
 * The belt a pointer on a tile means: the one standing highest, since that is the one drawn on top.
 * @param {ObjectsView} index
 * @param {number} tileX
 * @param {number} tileY
 * @returns {CacheEntry|null}
 */
export function getTopBeltAtOrNull(index, tileX, tileY) {
    let top = null;
    for (const entry of index.getAtTile(tileX, tileY)) {
        if (!isBeltType(entry.data.type)) {
            continue;
        }
        if (top === null || getBuildLevelByBeltKind(entry.data.type.beltKind) > getBuildLevelByBeltKind(top.data.type.beltKind)) {
            top = entry;
        }
    }
    return top;
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
 * (`BeltTool`), each supplying its own belt lookup.
 * @param {number} x
 * @param {number} y
 * @param {Direction} direction
 * @param {BeltType} kind - BELT_TUNNEL_DOWN or BELT_TUNNEL_UP
 * @param {function(number, number): {type: BeltType, direction: Direction}[]} beltsAt - candidates on a tile
 * @returns {object|null} the matched partner-kind belt (whatever shape `beltsAt` returns), or null
 */
export function getTunnelPartnerOrNull(x, y, direction, kind, beltsAt) {
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
