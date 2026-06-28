import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction, OCCUPANCY_LAYER_SURFACE} from "@/common/constants.js";
import {ClientCache} from "@/client/ClientCache.js";
import {OccupantKind, BeltType} from "./constants.js";
import {splitterConnections, inferBeltParent} from "./geometry.js";

// Register a single-tile surface object in the cache.
function surface(cache, id, x, y, data) {
    cache.set(id, x, y, [{x, y, layer: OCCUPANCY_LAYER_SURFACE}], data);
}

// Index a splitter's connection specs by key for assertions.
function byKey(x, y, direction) {
    const map = {};
    splitterConnections(x, y, direction).forEach(spec => {
        map[spec.key] = spec;
    });
    return map;
}

test("splitterConnections uses top-up/bottom-up for an UP splitter (both belts flow up)", () => {
    const c = byKey(5, 5, Direction.UP);
    // Two footprint cells: base (5,5) and the cell one step clockwise (6,5).
    assert.deepEqual(
        [c.out_0.tileX, c.out_0.tileY, c.out_0.neighborX, c.out_0.neighborY, c.out_0.base, c.out_0.angle],
        [5, 5, 5, 4, "machine-connection-top-up", 0],
    );
    assert.deepEqual(
        [c.in_0.tileX, c.in_0.tileY, c.in_0.neighborX, c.in_0.neighborY, c.in_0.base, c.in_0.angle],
        [5, 5, 5, 6, "machine-connection-bottom-up", 0],
    );
    assert.deepEqual([c.out_1.neighborX, c.out_1.neighborY], [6, 4]);
    assert.deepEqual([c.in_1.neighborX, c.in_1.neighborY], [6, 6]);
});

test("splitterConnections rotates the up-flow variants 180° for a DOWN splitter", () => {
    const c = byKey(5, 5, Direction.DOWN);
    assert.equal(c.out_0.base, "machine-connection-top-up");
    assert.equal(c.in_0.base, "machine-connection-bottom-up");
    assert.equal(c.out_0.angle, 180);
});

test("splitterConnections rotates the up-flow variant for a horizontal splitter (RIGHT)", () => {
    const c = byKey(5, 5, Direction.RIGHT);
    // Facing RIGHT: outputs to the right (x+1), inputs to the left (x-1); up-variant rotated 90°.
    assert.deepEqual([c.out_0.neighborX, c.out_0.neighborY], [6, 5]);
    assert.deepEqual([c.in_0.neighborX, c.in_0.neighborY], [4, 5]);
    assert.equal(c.out_0.base, "machine-connection-top-up");
    assert.equal(c.in_0.base, "machine-connection-bottom-up");
    assert.equal(c.out_0.angle, 90);
    assert.equal(c.in_0.angle, 90);
    assert.deepEqual([c.out_1.tileX, c.out_1.tileY], [5, 6]);
});

test("inferBeltParent finds a splitter feeding a belt that bends out of it", () => {
    const cache = new ClientCache();
    // Splitter at (13,5) facing UP occupies (13,5) and (14,5).
    cache.set(1n, 13, 5, [
        {x: 13, y: 5, layer: OCCUPANCY_LAYER_SURFACE},
        {x: 14, y: 5, layer: OCCUPANCY_LAYER_SURFACE},
    ], {kind: OccupantKind.SPLITTER, direction: Direction.UP});
    // Belt above the far cell, bending right — fed by the splitter's out_b.
    surface(cache, 2n, 14, 4, {kind: OccupantKind.BELT, direction: Direction.RIGHT, type: BeltType.NORMAL});

    const parent = inferBeltParent(cache, 14, 4, Direction.RIGHT);
    assert.deepEqual([parent.parentX, parent.parentY], [14, 5]);
});

test("inferBeltParent picks a straight upstream belt feeder", () => {
    const cache = new ClientCache();
    surface(cache, 5n, 5, 6, {kind: OccupantKind.BELT, direction: Direction.UP, type: BeltType.NORMAL});

    const parent = inferBeltParent(cache, 5, 5, Direction.UP);
    assert.deepEqual([parent.parentX, parent.parentY], [5, 6]);
});

test("inferBeltParent ignores a ramp entrance (it does not feed forward) and empty tiles", () => {
    const cache = new ClientCache();
    // A ramp-down behind faces UP but buries the flow, so it is not a feeder.
    surface(cache, 7n, 5, 6, {kind: OccupantKind.BELT, direction: Direction.UP, type: BeltType.RAMP_DOWN});

    const parent = inferBeltParent(cache, 5, 5, Direction.UP);
    assert.deepEqual([parent.parentX, parent.parentY], [null, null]);
});
