import {cellNeighbors, tileId} from "@/common/util.js";
import {NEIGHBOR_DELTAS} from "@/common/constants.js";

/**
 * Walks one road component out from `seed`: roads spread through their four neighbors, housings
 * bridge to the roads touching any of their cells. `seen` carries road tiles across seeds, so a
 * component never re-collects another's tiles; `housingAt` owns its own de-duplication and returns
 * null for a tile holding no fresh housing.
 * @param {object} options
 * @param {{x: number, y: number}} options.seed
 * @param {Map<number, {x: number, y: number}>} options.roadTiles - keyed by {@link tileId}
 * @param {Set<number>} options.seen - road tiles already claimed
 * @param {function(number, number): ({cells: {x: number, y: number}[]}|null)} options.housingAt
 * @param {function({x: number, y: number}): void} options.onRoad
 * @param {function({cells: {x: number, y: number}[]}): void} options.onHousing
 * @returns {void}
 */
export function floodRoadComponent({seed, roadTiles, seen, housingAt, onRoad, onHousing}) {
    const roadQueue = [seed];
    const housingQueue = [];
    const visit = (x, y) => {
        const tile = tileId(x, y);
        const road = roadTiles.get(tile);
        if (road !== undefined) {
            if (seen.has(tile)) {
                return;
            }
            seen.add(tile);
            onRoad(road);
            roadQueue.push(road);
            return;
        }
        const housing = housingAt(x, y);
        if (housing === null) {
            return;
        }
        onHousing(housing);
        housingQueue.push(housing);
    };
    while (roadQueue.length > 0 || housingQueue.length > 0) {
        if (roadQueue.length > 0) {
            const current = roadQueue.pop();
            for (const delta of NEIGHBOR_DELTAS) {
                visit(current.x + delta.dx, current.y + delta.dy);
            }
        } else {
            const housing = housingQueue.pop();
            for (const {x, y} of cellNeighbors(housing.cells)) {
                visit(x, y);
            }
        }
    }
}
