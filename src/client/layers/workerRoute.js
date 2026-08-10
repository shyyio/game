import {TILE_SIZE} from "@/client/constants.js";
import {LAYER_SURFACE, NEIGHBOR_DELTAS} from "@/common/constants.js";
import {cellNeighbors, tileId} from "@/common/util.js";
import {RoadBehavior} from "@/sim/behaviors/RoadBehavior.js";

/**
 * The walkable entry covering a tile — a road or a housing (commutes cross the housings that
 * bridge road stretches) — or null when the tile holds neither.
 * @param {ObjectsView} cache
 * @param {number} x
 * @param {number} y
 * @returns {CacheEntry|null}
 */
function walkableAt(cache, x, y) {
    const entry = cache.at(x, y, LAYER_SURFACE);
    if (entry === null) {
        return null;
    }
    const behavior = entry.behavior;
    if (behavior instanceof RoadBehavior || (behavior !== null && behavior.workerSupply > 0)) {
        return entry;
    }
    return null;
}

/**
 * The world-px center of an entry's footprint.
 * @param {CacheEntry} entry
 * @returns {{x: number, y: number}}
 */
function entryCenter(entry) {
    const centroid = entry.tileCentroid;
    return {
        x: centroid.tileX * TILE_SIZE + TILE_SIZE / 2,
        y: centroid.tileY * TILE_SIZE + TILE_SIZE / 2,
    };
}

/**
 * BFS outward from the machine's edge over the cached road and housing tiles; the first housing
 * reached is the nearest one in the machine's network, and the shortest route to it comes back as
 * world-px waypoints (housing center first, walked tile centers, machine center last), or null
 * when no cached road/housing chain reaches a housing.
 * @param {ObjectsView} cache
 * @param {CacheEntry} machineEntry
 * @returns {{x: number, y: number}[]|null}
 */
export function findCommuteRoute(cache, machineEntry) {
    // parent: walked tile -> the tile it was reached from (null for a seed by the machine).
    const parents = new Map();
    const queue = [];
    for (const {x, y} of cellNeighbors(machineEntry.cells)) {
        const tile = tileId(x, y);
        if (parents.has(tile)) {
            continue;
        }
        const entry = walkableAt(cache, x, y);
        if (entry === null) {
            continue;
        }
        parents.set(tile, null);
        queue.push({x, y, tile, entry});
    }

    let goal = null;
    for (let head = 0; head < queue.length; head += 1) {
        const current = queue[head];
        if (current.entry.behavior.workerSupply > 0) {
            goal = current;
            break;
        }
        for (const delta of NEIGHBOR_DELTAS) {
            const x = current.x + delta.dx;
            const y = current.y + delta.dy;
            const tile = tileId(x, y);
            if (parents.has(tile)) {
                continue;
            }
            const entry = walkableAt(cache, x, y);
            if (entry === null) {
                continue;
            }
            parents.set(tile, current);
            queue.push({x, y, tile, entry});
        }
    }
    if (goal === null) {
        return null;
    }

    // The goal tile is the housing's edge cell; its center follows, so the walk starts there.
    const waypoints = [entryCenter(goal.entry)];
    for (let node = parents.get(goal.tile); node !== null; node = parents.get(node.tile)) {
        waypoints.push({
            x: node.x * TILE_SIZE + TILE_SIZE / 2,
            y: node.y * TILE_SIZE + TILE_SIZE / 2,
        });
    }
    waypoints.push(entryCenter(machineEntry));
    return waypoints;
}
