import test from "node:test";
import assert from "node:assert/strict";
import {floodRoadComponent} from "@/common/roadFlood.js";
import {tileId} from "@/common/util.js";

/**
 * A road map over the given tiles, each cell its own `{x, y}` record.
 */
function roadMap(cells) {
    const tiles = new Map();
    for (const {x, y} of cells) {
        tiles.set(tileId(x, y), {x, y});
    }
    return tiles;
}

test("collects the roads reachable from the seed, skipping the ones already seen", () => {
    const roadTiles = roadMap([{x: 0, y: 0}, {x: 1, y: 0}, {x: 2, y: 0}, {x: 9, y: 9}]);
    const seen = new Set([tileId(0, 0)]);
    const roads = [];

    floodRoadComponent({
        seed: roadTiles.get(tileId(0, 0)),
        roadTiles,
        seen,
        housingAt: () => null,
        onRoad: (road) => roads.push(road),
        onHousing: () => {},
    });

    assert.deepEqual(roads.sort((a, b) => a.x - b.x), [{x: 1, y: 0}, {x: 2, y: 0}]);
});

test("crosses a housing's cells to reach the roads on its far side", () => {
    const roadTiles = roadMap([{x: 0, y: 0}, {x: 3, y: 0}]);
    const housing = {cells: [{x: 1, y: 0}, {x: 2, y: 0}]};
    const seen = new Set([tileId(0, 0)]);
    const roads = [];
    const housings = [];
    let handed = false;

    floodRoadComponent({
        seed: roadTiles.get(tileId(0, 0)),
        roadTiles,
        seen,
        housingAt: (x, y) => {
            if (handed || x !== 1 || y !== 0) {
                return null;
            }
            handed = true;
            return housing;
        },
        onRoad: (road) => roads.push(road),
        onHousing: (found) => housings.push(found),
    });

    assert.deepEqual(roads, [{x: 3, y: 0}]);
    assert.deepEqual(housings, [housing]);
});
