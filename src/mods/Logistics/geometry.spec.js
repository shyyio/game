import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction, OCCUPANCY_LAYER_SURFACE} from "@/common/constants.js";
import {ObjectDefinition, PortDefinition} from "@/common/core.js";
import {ClientCache} from "@/client/ClientCache.js";
import {BeltType} from "./constants.js";
import {inferBeltParent} from "./geometry.js";
import {BeltDefinition, SplitterDefinition} from "./definitions.js";

// Register a single-tile surface object in the cache.
function surface(cache, id, x, y, data) {
    cache.set(id, x, y, [{x, y, layer: OCCUPANCY_LAYER_SURFACE}], {}, data);
}

test("inferBeltParent finds a splitter feeding a belt that bends out of it", () => {
    const cache = new ClientCache();
    // Splitter at (13,5) facing UP occupies (13,5) and (14,5).
    cache.set(1n, 13, 5, [
        {x: 13, y: 5, layer: OCCUPANCY_LAYER_SURFACE},
        {x: 14, y: 5, layer: OCCUPANCY_LAYER_SURFACE},
    ], {}, {definition: SplitterDefinition, direction: Direction.UP});
    // Belt above the far cell, bending right — fed by the splitter's out_b.
    surface(cache, 2n, 14, 4, {definition: BeltDefinition, direction: Direction.RIGHT, type: BeltType.NORMAL});

    const parent = inferBeltParent(cache, 14, 4, Direction.RIGHT);
    assert.deepEqual([parent.parentX, parent.parentY], [14, 5]);
});

test("inferBeltParent picks a straight upstream belt feeder", () => {
    const cache = new ClientCache();
    surface(cache, 5n, 5, 6, {definition: BeltDefinition, direction: Direction.UP, type: BeltType.NORMAL});

    const parent = inferBeltParent(cache, 5, 5, Direction.UP);
    assert.deepEqual([parent.parentX, parent.parentY], [5, 6]);
});

test("inferBeltParent ignores a ramp entrance (it does not feed forward) and empty tiles", () => {
    const cache = new ClientCache();
    // A ramp-down behind faces UP but buries the flow, so it is not a feeder.
    surface(cache, 7n, 5, 6, {definition: BeltDefinition, direction: Direction.UP, type: BeltType.RAMP_DOWN});

    const parent = inferBeltParent(cache, 5, 5, Direction.UP);
    assert.deepEqual([parent.parentX, parent.parentY], [null, null]);
});

// A 1x1 machine facing UP: input on its tile, output one tile ahead.
const machineDefinition = new ObjectDefinition({
    table: "Machine",
    inputPorts: [new PortDefinition("in", {x: 0, y: 0, direction: Direction.UP})],
    outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
    internalPorts: [],
    geometry: "1x1",
});

test("a machine between a tunnel's ramps connects to neither buried end", () => {
    const cache = new ClientCache();
    // A vertical tunnel: RAMP_DOWN entrance below, RAMP_UP exit above, both facing UP. The
    // machine sits between them; the ramps' surface ports face away from it (both buried).
    surface(cache, 1n, 14, 8, {definition: BeltDefinition, direction: Direction.UP, type: BeltType.RAMP_DOWN});
    surface(cache, 3n, 14, 6, {definition: BeltDefinition, direction: Direction.UP, type: BeltType.RAMP_UP});
    surface(cache, 4n, 14, 7, {definition: machineDefinition, direction: Direction.UP});

    assert.deepEqual(cache.connectedPorts(cache.get(4n)), []);
});

test("a machine connects to a ramp's exposed surface ports", () => {
    const cache = new ClientCache();
    // RAMP_DOWN entrance takes a surface feed from behind (its output is buried, not its input).
    surface(cache, 1n, 5, 4, {definition: BeltDefinition, direction: Direction.UP, type: BeltType.RAMP_DOWN});
    surface(cache, 2n, 5, 5, {definition: machineDefinition, direction: Direction.UP});
    // RAMP_UP exit emits forward onto the surface (its input is buried, not its output).
    surface(cache, 3n, 5, 6, {definition: BeltDefinition, direction: Direction.UP, type: BeltType.RAMP_UP});

    const connections = cache.connectedPorts(cache.get(2n));
    assert.deepEqual(connections.map(connection => connection.neighbor.id).sort(), [1n, 3n]);
});

test("inferBeltParent recognizes a non-belt object (a machine) feeding a belt", () => {
    // The belt must bend toward the machine without any belt-side knowledge of the machine's type.
    const cache = new ClientCache();
    // Machine to the left of the belt, facing right — feeds the belt from the side (a bend).
    surface(cache, 9n, 4, 5, {definition: machineDefinition, direction: Direction.RIGHT});

    const parent = inferBeltParent(cache, 5, 5, Direction.UP);
    assert.deepEqual([parent.parentX, parent.parentY], [4, 5]);
});
