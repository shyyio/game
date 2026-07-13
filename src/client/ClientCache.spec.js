import {test} from "node:test";
import assert from "node:assert";

import {ClientCache} from "@/client/ClientCache.js";
import {ObjectDefinition, PortDefinition} from "@/common/core.js";
import {Direction, OCCUPANCY_LAYER_SURFACE} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";

// A single-cell object on layer 0 at its primary tile.
function cell(x, y, layer=0) {
    return [{x, y, layer}];
}

// A 1x1 object with one input on its tile and one output one tile ahead, both facing UP.
const machineDefinition = new ObjectDefinition({
    name: "Machine",
    inputPorts: [new PortDefinition("in", {x: 0, y: 0, direction: Direction.UP})],
    outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
    internalPorts: [],
    geometry: "1x1",
});
// Registers a surface machine facing `direction`.
function machine(cache, id, x, y, direction) {
    cache.set(id, x, y, [{x, y, layer: OCCUPANCY_LAYER_SURFACE}], {}, {definition: machineDefinition, direction});
}

test("set then get returns the record with derived chunk", () => {
    const cache = new ClientCache();
    cache.set(1, 3, 4, cell(3, 4), {}, {type: 0});

    const record = cache.get(1);
    assert.strictEqual(record.id, 1);
    assert.strictEqual(record.tileX, 3);
    assert.strictEqual(record.tileY, 4);
    assert.strictEqual(record.chunk, chunkId(3, 4));
    assert.deepStrictEqual(record.data, {type: 0});
});

test("getAtTile returns every object on a primary tile", () => {
    const cache = new ClientCache();
    cache.set(1, 5, 5, cell(5, 5, 0), {}, {type: 0});
    cache.set(2, 5, 5, cell(5, 5, 1), {}, {type: 3});

    const records = cache.getAtTile(5, 5);
    assert.strictEqual(records.length, 2);
    assert.deepStrictEqual(records.map(record => record.id).sort(), [1, 2]);
    assert.deepStrictEqual(cache.getAtTile(9, 9), []);
});

test("at resolves an object by cell and layer; layers are independent", () => {
    const cache = new ClientCache();
    cache.set(1, 5, 5, cell(5, 5, 0), {}, {kind: 0});
    cache.set(2, 5, 5, cell(5, 5, 1), {}, {kind: 9});

    assert.strictEqual(cache.at(5, 5, 0).id, 1);
    assert.strictEqual(cache.at(5, 5, 1).id, 2);
    assert.strictEqual(cache.at(5, 5, 2), null);
});

test("set with multiple cells indexes every covered cell", () => {
    const cache = new ClientCache();
    cache.set(1, 5, 5, [{x: 5, y: 5, layer: 0}, {x: 6, y: 5, layer: 0}], {}, {kind: 1});

    assert.strictEqual(cache.at(5, 5, 0).id, 1);
    assert.strictEqual(cache.at(6, 5, 0).id, 1);
});

test("update merges into a record's data", () => {
    const cache = new ClientCache();
    cache.set(1, 0, 0, cell(0, 0), {}, {a: 1});
    cache.update(1, {b: 2});

    assert.deepStrictEqual(cache.get(1).data, {a: 1, b: 2});
    cache.update(99, {b: 3});
    assert.strictEqual(cache.get(99), null);
});

test("remove clears all indexes and returns the record", () => {
    const cache = new ClientCache();
    cache.set(1, 7, 8, cell(7, 8), {}, {type: 0});

    const removed = cache.remove(1);
    assert.strictEqual(removed.id, 1);
    assert.strictEqual(cache.get(1), null);
    assert.deepStrictEqual(cache.getAtTile(7, 8), []);
    assert.strictEqual(cache.at(7, 8, 0), null);
    assert.deepStrictEqual(cache.getByChunk(chunkId(7, 8)), []);
    assert.strictEqual(cache.remove(1), null);
});

test("set replaces a prior registration's cells", () => {
    const cache = new ClientCache();
    cache.set(1, 5, 5, cell(5, 5, 0), {}, {kind: 0});
    cache.set(1, 5, 5, cell(5, 5, 1), {}, {kind: 0});

    assert.strictEqual(cache.at(5, 5, 0), null);
    assert.strictEqual(cache.at(5, 5, 1).id, 1);
});

test("getByChunk returns objects grouped by chunk", () => {
    const cache = new ClientCache();
    cache.set(1, 1, 1, cell(1, 1), {}, {type: 0});
    cache.set(2, 2, 2, cell(2, 2), {}, {type: 0});
    cache.set(3, 200, 200, cell(200, 200), {}, {type: 0});

    const near = cache.getByChunk(chunkId(1, 1));
    assert.strictEqual(near.length, 2);
    assert.deepStrictEqual(near.map(record => record.id).sort(), [1, 2]);
    assert.strictEqual(cache.getByChunk(chunkId(200, 200)).length, 1);
});

test("getByPort resolves a rendered out-port to its entry and port name", () => {
    const cache = new ClientCache();
    cache.set(1, 5, 5, cell(5, 5), {out_port_id: 42}, {type: 0});

    const entry = cache.getByPort(42);
    assert.strictEqual(entry.id, 1);
    assert.strictEqual(entry.portName(42), "out_port_id");
    assert.strictEqual(cache.getByPort(99), null);

    cache.remove(1);
    assert.strictEqual(cache.getByPort(42), null);
});

test("inPortAt / outPortAt resolve a feeder-consumer pair facing each other", () => {
    const cache = new ClientCache();
    // Feeder at (5,6) outputs up into (5,5); consumer at (5,5) takes input there.
    machine(cache, 1, 5, 6, Direction.UP);
    machine(cache, 2, 5, 5, Direction.UP);

    const consumer = cache.inPortAt(5, 5, Direction.UP);
    assert.strictEqual(consumer.entry.id, 2);
    assert.strictEqual(consumer.portName, "in");

    const feeder = cache.outPortAt(5, 5, Direction.UP);
    assert.strictEqual(feeder.entry.id, 1);
    assert.strictEqual(feeder.portName, "out");

    // Wrong facing and an empty tile resolve to nothing.
    assert.strictEqual(cache.inPortAt(5, 5, Direction.DOWN), null);
    assert.strictEqual(cache.inPortAt(9, 9, Direction.UP), null);
});

test("connectedPorts reports a record's live output connection", () => {
    const cache = new ClientCache();
    machine(cache, 1, 5, 6, Direction.UP);
    machine(cache, 2, 5, 5, Direction.UP);

    const connections = cache.connectedPorts(cache.get(1));
    assert.strictEqual(connections.length, 1);
    assert.strictEqual(connections[0].key, "out");
    assert.strictEqual(connections[0].isOutput, true);
    assert.strictEqual(connections[0].neighbor.id, 2);

    // The lone consumer has only its incoming connection.
    const incoming = cache.connectedPorts(cache.get(2));
    assert.strictEqual(incoming.length, 1);
    assert.strictEqual(incoming[0].isOutput, false);
    assert.strictEqual(incoming[0].neighbor.id, 1);
});
