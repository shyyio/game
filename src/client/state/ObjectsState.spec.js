import {test} from "node:test";
import assert from "node:assert";

import {ObjectsView, ObjectClientEntry} from "@/client/state/ObjectsState.js";
import {AbstractBehavior} from "@/common/behaviors/AbstractBehavior.js";
import {SyncedFieldSet, SyncedField, FIELD_ROLE_PRODUCT} from "@/common/SyncedFieldSet.js";
import {EMPTY} from "@/sim/AbstractComponent.js";
import {ObjectType, PortDefinition} from "@/common/ObjectType.js";
import {Direction, LAYER_SURFACE} from "@/common/constants.js";
import {chunkKeyAt} from "@/common/util.js";
import {TILE_SIZE} from "@/client/constants.js";

// A single-cell object on layer 0 at its primary tile.
function cell(x, y, layer=0) {
    return [{x, y, layer}];
}

// A 1x1 object with one input on its tile and one output one tile ahead, both facing UP.
const machineType = new ObjectType({
    name: "Machine",
    inputPorts: [new PortDefinition("inputPort", {x: 0, y: 0, direction: Direction.UP})],
    outputPorts: [new PortDefinition("outputPort", {x: 0, y: -1, direction: Direction.UP})],
    internalPorts: [],
    geometry: "1x1",
});
const ITEM_TYPE_ID = 7;

const PRODUCER_SYNCED_FIELDS = new SyncedFieldSet("Producer", [new SyncedField("lastOutput", EMPTY, FIELD_ROLE_PRODUCT)]);

class ProducerBehavior extends AbstractBehavior {

    get syncedFields() {
        return PRODUCER_SYNCED_FIELDS;
    }
}

// A 1x1 object syncing the item it last produced.
const producerType = new ObjectType({
    name: "Producer",
    geometry: "1x1",
    behavior: new ProducerBehavior(),
});
// Registers a surface machine facing `direction`.
function machine(cache, id, x, y, direction) {
    cache.set(id, x, y, [{x, y, layer: LAYER_SURFACE}], {}, {type: machineType, direction});
}

test("set then get returns the entry with derived chunk", () => {
    const cache = new ObjectsView(null);
    cache.set(1, 3, 4, cell(3, 4), {}, {type: 0});

    const entry = cache.get(1);
    assert.strictEqual(entry.id, 1);
    assert.strictEqual(entry.tileX, 3);
    assert.strictEqual(entry.tileY, 4);
    assert.strictEqual(entry.chunkKey, chunkKeyAt(3, 4));
    assert.deepStrictEqual(entry.data, {type: 0});
});

test("getAtTile returns every object on a primary tile", () => {
    const cache = new ObjectsView(null);
    cache.set(1, 5, 5, cell(5, 5, 0), {}, {type: 0});
    cache.set(2, 5, 5, cell(5, 5, 1), {}, {type: 3});

    const entries = cache.getAtTile(5, 5);
    assert.strictEqual(entries.length, 2);
    assert.deepStrictEqual(entries.map(entry => entry.id).sort(), [1, 2]);
    assert.deepStrictEqual(cache.getAtTile(9, 9), []);
});

test("at resolves an object by cell and layer; layers are independent", () => {
    const cache = new ObjectsView(null);
    cache.set(1, 5, 5, cell(5, 5, 0), {}, {kind: 0});
    cache.set(2, 5, 5, cell(5, 5, 1), {}, {kind: 9});

    assert.strictEqual(cache.getObjectAtOrNull(5, 5, 0).id, 1);
    assert.strictEqual(cache.getObjectAtOrNull(5, 5, 1).id, 2);
    assert.strictEqual(cache.getObjectAtOrNull(5, 5, 2), null);
});

test("allAt returns the full stack on a cell, bottom-up", () => {
    const cache = new ObjectsView(null);
    cache.set(1, 5, 5, cell(5, 5, 0), {}, {kind: 0});
    cache.set(2, 5, 5, cell(5, 5, 0), {}, {kind: 9});

    assert.deepStrictEqual(cache.getObjectsAt(5, 5, 0).map(entry => entry.id), [1, 2]);
    assert.deepStrictEqual(cache.getObjectsAt(5, 5, 1), []);
    cache.remove(2);
    assert.deepStrictEqual(cache.getObjectsAt(5, 5, 0).map(entry => entry.id), [1]);
});

test("set with multiple cells indexes every covered cell", () => {
    const cache = new ObjectsView(null);
    cache.set(1, 5, 5, [{x: 5, y: 5, layer: 0}, {x: 6, y: 5, layer: 0}], {}, {kind: 1});

    assert.strictEqual(cache.getObjectAtOrNull(5, 5, 0).id, 1);
    assert.strictEqual(cache.getObjectAtOrNull(6, 5, 0).id, 1);
});

test("apply merges into a entry's data", () => {
    const cache = new ObjectsView(null);
    cache.set(1, 0, 0, cell(0, 0), {}, {a: 1});
    cache.apply(1, {b: 2});

    assert.deepStrictEqual(cache.get(1).data, {a: 1, b: 2});
    cache.apply(99, {b: 3});
    assert.strictEqual(cache.get(99), null);
});

test("remove clears all indexes and returns the entry", () => {
    const cache = new ObjectsView(null);
    cache.set(1, 7, 8, cell(7, 8), {}, {type: 0});

    const removed = cache.remove(1);
    assert.strictEqual(removed.id, 1);
    assert.strictEqual(cache.get(1), null);
    assert.deepStrictEqual(cache.getAtTile(7, 8), []);
    assert.strictEqual(cache.getObjectAtOrNull(7, 8, 0), null);
    assert.deepStrictEqual(cache.getByChunk(chunkKeyAt(7, 8)), []);
    assert.strictEqual(cache.remove(1), null);
});

test("set replaces a prior registration's cells", () => {
    const cache = new ObjectsView(null);
    cache.set(1, 5, 5, cell(5, 5, 0), {}, {kind: 0});
    cache.set(1, 5, 5, cell(5, 5, 1), {}, {kind: 0});

    assert.strictEqual(cache.getObjectAtOrNull(5, 5, 0), null);
    assert.strictEqual(cache.getObjectAtOrNull(5, 5, 1).id, 1);
});

test("getByChunk returns objects grouped by chunk", () => {
    const cache = new ObjectsView(null);
    cache.set(1, 1, 1, cell(1, 1), {}, {type: 0});
    cache.set(2, 2, 2, cell(2, 2), {}, {type: 0});
    cache.set(3, 200, 200, cell(200, 200), {}, {type: 0});

    const near = cache.getByChunk(chunkKeyAt(1, 1));
    assert.strictEqual(near.length, 2);
    assert.deepStrictEqual(near.map(entry => entry.id).sort(), [1, 2]);
    assert.strictEqual(cache.getByChunk(chunkKeyAt(200, 200)).length, 1);
});

test("getByPort resolves a rendered output port to its entry and port name", () => {
    const cache = new ObjectsView(null);
    cache.set(1, 5, 5, cell(5, 5), {out_port_id: 42}, {type: 0});

    const entry = cache.getByPort(42);
    assert.strictEqual(entry.id, 1);
    assert.strictEqual(entry.portName(42), "out_port_id");
    assert.strictEqual(cache.getByPort(99), null);

    cache.remove(1);
    assert.strictEqual(cache.getByPort(42), null);
});

test("getInputPortAtOrNull / getOutputPortAtOrNull resolve a parent-child pair facing each other", () => {
    const cache = new ObjectsView(null);
    // Parent at (5,6) outputs up into (5,5); child at (5,5) takes input there.
    machine(cache, 1, 5, 6, Direction.UP);
    machine(cache, 2, 5, 5, Direction.UP);

    const consumer = cache.getInputPortAtOrNull(5, 5, Direction.UP);
    assert.strictEqual(consumer.entry.id, 2);
    assert.strictEqual(consumer.portName, "inputPort");

    const parent = cache.getOutputPortAtOrNull(5, 5, Direction.UP);
    assert.strictEqual(parent.entry.id, 1);
    assert.strictEqual(parent.portName, "outputPort");

    // Wrong facing and an empty tile resolve to nothing.
    assert.strictEqual(cache.getInputPortAtOrNull(5, 5, Direction.DOWN), null);
    assert.strictEqual(cache.getInputPortAtOrNull(9, 9, Direction.UP), null);
});

test("connectedPorts reports a entry's live output connection", () => {
    const cache = new ObjectsView(null);
    machine(cache, 1, 5, 6, Direction.UP);
    machine(cache, 2, 5, 5, Direction.UP);

    const connections = cache.connectedPorts(cache.get(1));
    assert.strictEqual(connections.length, 1);
    assert.strictEqual(connections[0].key, "outputPort");
    assert.strictEqual(connections[0].isOutput, true);
    assert.strictEqual(connections[0].neighbor.id, 2);

    // The lone consumer has only its incoming connection.
    const incoming = cache.connectedPorts(cache.get(2));
    assert.strictEqual(incoming.length, 1);
    assert.strictEqual(incoming[0].isOutput, false);
    assert.strictEqual(incoming[0].neighbor.id, 1);
});

test("an entry reports the product its behavior syncs, and EMPTY before the first one", () => {
    const cache = new ObjectsView(null);
    cache.set(1, 2, 2, cell(2, 2), {}, new ObjectClientEntry(producerType, Direction.UP));
    assert.strictEqual(cache.get(1).productItemTypeId, EMPTY);

    cache.apply(1, {lastOutput: ITEM_TYPE_ID});
    assert.strictEqual(cache.get(1).productItemTypeId, ITEM_TYPE_ID);
});

test("an object whose behavior produces nothing reports no product", () => {
    const cache = new ObjectsView(null);
    cache.set(1, 2, 2, cell(2, 2), {}, new ObjectClientEntry(machineType, Direction.UP));
    assert.strictEqual(cache.get(1).productItemTypeId, EMPTY);
});

test("a single-tile entry centers in the middle of its tile", () => {
    const cache = new ObjectsView(null);
    machine(cache, 1, 3, 4, Direction.UP);
    assert.deepStrictEqual(cache.get(1).center, {x: 3.5 * TILE_SIZE, y: 4.5 * TILE_SIZE});
});

test("a multi-tile entry centers in the middle of its footprint", () => {
    const cache = new ObjectsView(null);
    const cells = [
        {x: 2, y: 2, layer: LAYER_SURFACE},
        {x: 3, y: 2, layer: LAYER_SURFACE},
        {x: 2, y: 3, layer: LAYER_SURFACE},
        {x: 3, y: 3, layer: LAYER_SURFACE},
    ];
    cache.set(1, 2, 2, cells, {}, {type: machineType, direction: Direction.UP});
    assert.deepStrictEqual(cache.get(1).center, {x: 3 * TILE_SIZE, y: 3 * TILE_SIZE});
});
