import {Direction} from "@/common/constants.js";
import {chunkKeyAt, rotate} from "@/common/util.js";
import {BLOCKED_REASON_CROSSES_CHUNK, BLOCKED_REASON_OCCUPIED} from "@/client/input/placementBlockedReasons.js";

/**
 * @typedef {Object} PlacementCells
 * @property {Point[]} blockedCells
 * @property {Point[]} overwriteCells the occupied cells, or every cell when the same object already stands there
 * @property {Point[]} clearCells
 * @property {number[]} overwriteIds the occupants an overwrite deletes
 * @property {string|null} blockedReason why the placement is blocked, null when it is not
 * @property {boolean} isAlreadyPlaced the same object already stands there, so placing it changes nothing
 */

/**
 * The world tiles a `placeOn` type may be placed on: every extraction tile of every cached target
 * object, rotated by its facing.
 * @param {Client} client
 * @param {ObjectType} type
 * @returns {Point[]}
 */
export function getPlaceOnTargetTiles(client, type) {
    const tiles = [];
    for (const entry of client.objects.values()) {
        if (!type.placement.placeOn.includes(entry.data.type)) {
            continue;
        }
        for (const tile of entry.data.type.extractionTiles) {
            const cell = rotate({x: tile.x, y: tile.y, direction: Direction.UP}, entry.data.direction);
            tiles.push({x: entry.tileX + cell.x, y: entry.tileY + cell.y});
        }
    }
    return tiles;
}

/**
 * Classifies each geometry cell of `type` placed at (tileX, tileY) facing `direction`: crossing the
 * base chunk, off every placeOn target, or holding a non-overwritable occupant is blocked; holding
 * an overwritable occupant is overwrite (collected for deletion); otherwise clear. The whole
 * placement's veto (chunk, limit, mod) outranks any cell's reason.
 * @param {Client} client
 * @param {ObjectType} type
 * @param {number} tileX
 * @param {number} tileY
 * @param {Direction} direction
 * @returns {PlacementCells}
 */
export function evaluatePlacement(client, type, tileX, tileY, direction) {
    if (isAlreadyPlacedAt(client, type, tileX, tileY, direction)) {
        const overwriteCells = type.geometry.getTilesByDirection(direction).map(cell => ({x: tileX + cell.x, y: tileY + cell.y}));
        return {blockedCells: [], overwriteCells, clearCells: [], overwriteIds: [], blockedReason: null, isAlreadyPlaced: true};
    }
    const base = chunkKeyAt(tileX, tileY);
    let targetKeys = null;
    if (type.placement.placeOn.length > 0) {
        targetKeys = new Set(getPlaceOnTargetTiles(client, type).map(tile => `${tile.x},${tile.y}`));
    }

    // The first blocked cell's reason is the placement's.
    const bodyByKey = new Map();
    const overwriteIds = new Set();
    let blockedReason = null;
    for (const cell of type.geometry.getTilesByDirection(direction)) {
        const world = {x: tileX + cell.x, y: tileY + cell.y};
        const key = `${world.x},${world.y}`;
        if (chunkKeyAt(world.x, world.y) !== base) {
            bodyByKey.set(key, {cell: world, state: "blocked"});
            if (blockedReason === null) {
                blockedReason = BLOCKED_REASON_CROSSES_CHUNK;
            }
            continue;
        }
        if (targetKeys !== null && !targetKeys.has(key)) {
            bodyByKey.set(key, {cell: world, state: "blocked"});
            if (blockedReason === null) {
                blockedReason = `Needs ${type.placement.placeOn.map(target => target.label).join(" or ")}`;
            }
            continue;
        }
        const occupant = getSolidOccupantAtOrNull(client, world.x, world.y, type.positionLayer);
        if (occupant === null) {
            bodyByKey.set(key, {cell: world, state: "clear"});
        } else if (isOccupantOverwritable(type, occupant, direction)) {
            bodyByKey.set(key, {cell: world, state: "overwrite", id: occupant.id});
            overwriteIds.add(occupant.id);
        } else {
            bodyByKey.set(key, {cell: world, state: "blocked"});
            if (blockedReason === null) {
                blockedReason = BLOCKED_REASON_OCCUPIED;
            }
        }
    }

    // Mirror the sim's per-layer positions: any footprint cell on a same-layer solid occupant is
    // blocked (overwritten occupants excluded).
    const blockedCells = [];
    for (const {layer, cells} of type.getPositionLayerTilesByDirection(direction)) {
        for (const cell of cells) {
            const world = {x: tileX + cell.x, y: tileY + cell.y};
            if (!isOccupiedAt(client, world.x, world.y, layer, overwriteIds)) {
                continue;
            }
            if (blockedReason === null) {
                blockedReason = BLOCKED_REASON_OCCUPIED;
            }
            const key = `${world.x},${world.y}`;
            const body = bodyByKey.get(key);
            if (body !== undefined) {
                body.state = "blocked";
                body.id = undefined;
            } else if (!blockedCells.some(c => c.x === world.x && c.y === world.y)) {
                blockedCells.push(world);
            }
        }
    }

    const overwriteCells = [];
    const clearCells = [];
    for (const entry of bodyByKey.values()) {
        if (entry.state === "blocked") {
            blockedCells.push(entry.cell);
        } else if (entry.state === "overwrite") {
            overwriteCells.push(entry.cell);
        } else {
            clearCells.push(entry.cell);
        }
    }

    const veto = client.getPlacementBlockedReasonOrNull(type, tileX, tileY, direction);
    if (veto !== null) {
        for (const cell of overwriteCells) {
            blockedCells.push(cell);
        }
        for (const cell of clearCells) {
            blockedCells.push(cell);
        }
        return {blockedCells, overwriteCells: [], clearCells: [], overwriteIds: [], blockedReason: veto, isAlreadyPlaced: false};
    }

    // Overwrites survive only if no body cell got re-blocked above.
    const finalOverwriteIds = overwriteCells.map(cell => bodyByKey.get(`${cell.x},${cell.y}`).id);
    return {blockedCells, overwriteCells, clearCells, overwriteIds: finalOverwriteIds, blockedReason, isAlreadyPlaced: false};
}

/**
 * Whether an object of `type` stands at (tileX, tileY) with the same facing.
 * @param {Client} client
 * @param {ObjectType} type
 * @param {number} tileX
 * @param {number} tileY
 * @param {Direction} direction
 * @returns {boolean}
 */
function isAlreadyPlacedAt(client, type, tileX, tileY, direction) {
    return client.objects.getObjectsAt(tileX, tileY, type.positionLayer)
        .some(entry => entry.data.type === type && entry.tileX === tileX && entry.tileY === tileY
            && (!type.directional || entry.data.direction === direction));
}

/**
 * The topmost solid object covering the tile on `layer`, or null; a non-solid object (a water body)
 * occupies nothing.
 * @param {Client} client
 * @param {number} tileX
 * @param {number} tileY
 * @param {string} layer
 * @returns {CacheEntry|null}
 */
function getSolidOccupantAtOrNull(client, tileX, tileY, layer) {
    const stacked = client.objects.getObjectsAt(tileX, tileY, layer);
    for (let i = stacked.length - 1; i >= 0; i -= 1) {
        if (stacked[i].data.type.placement.isSolid) {
            return stacked[i];
        }
    }
    return null;
}

/**
 * Whether a solid object other than the overwritten ones covers the tile on `layer`.
 * @param {Client} client
 * @param {number} tileX
 * @param {number} tileY
 * @param {string} layer
 * @param {Set<number>} excludeIds
 * @returns {boolean}
 */
function isOccupiedAt(client, tileX, tileY, layer, excludeIds) {
    return client.objects.getObjectsAt(tileX, tileY, layer)
        .some(entry => entry.data.type.placement.isSolid && !excludeIds.has(entry.id));
}

/**
 * Whether a surface occupant may be deleted to lay `type` over it: an aligned conveyor lane, or,
 * when the type opts in, another object of the same type.
 * @param {ObjectType} type
 * @param {CacheEntry} occupant
 * @param {Direction} direction
 * @returns {boolean}
 */
function isOccupantOverwritable(type, occupant, direction) {
    if (type.placement.shouldReplaceSameKind && occupant.data.type.objectTypeId === type.objectTypeId) {
        return true;
    }
    if (!type.directional) {
        // No facing, no alignment: UP would match every vertical lane tile.
        return false;
    }
    return occupant.data.type.placement.isConveyor
        && Direction.axis(occupant.data.direction) === Direction.axis(direction);
}
