import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction, CHUNK_SIZE} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";
import {PortItemSetEvent, PortItemClearEvent} from "@/common/PortItemEvents.js";
import {
    LaneGeometryEvent,
    LaneItemUpsertEvent,
    LaneItemSyncEvent,
    LaneItemDeleteEvent,
    LaneItemBatchEvent,
} from "@/common/LaneEvents.js";
import {ModPackage} from "@/common/ModPackage.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {EventCollector} from "@/test/EventCollector.js";
import {
    LaneFixtureDeclaration,
    ITEM_TYPE_TEST_CARGO,
    placeLane,
    deleteLane,
    laneAt,
} from "@/test/laneFixture.js";

const CARGO = ITEM_TYPE_TEST_CARGO;

async function setup() {
    return makeGameEngine([new ModPackage(new LaneFixtureDeclaration())]);
}

// A moving item emits an upsert when it enters and a delete when it pops, both keyed by lane id, so
// the client can glide one sprite along the lane body.
test("an item emits an upsert on ingest and a delete on pop", async () => {
    const engine = await setup();
    const collector = new EventCollector(engine);
    for (const y of [0, 1, 2]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const lane = laneAt(engine, 0, 2);
    collector.drain();

    engine.ports.setItem(engine.lanes.inPortOf(lane), CARGO);
    const rows = [];
    for (let i = 0; i < 8; i += 1) {
        engine.tickAll();
        for (const event of collector.drain()) {
            if (event instanceof LaneItemUpsertEvent || event instanceof LaneItemDeleteEvent) {
                rows.push(event);
            }
        }
    }

    assert.ok(rows.some(event => event instanceof LaneItemUpsertEvent && event.itemTypeId === CARGO), "the item is upserted");
    assert.ok(rows.some(event => event instanceof LaneItemDeleteEvent), "and deleted when it pops");
    assert.ok(rows.every(event => event.laneRef === lane), "every row carries the lane id");
});

// A tick's deltas leave the engine as one batch per chunk, not one event per item.
test("a move pass emits one item batch per chunk", async () => {
    const engine = await setup();
    const emitted = [];
    const origins = [[0, 0], [4, 0], [CHUNK_SIZE, 0]];
    const lanes = origins.map(origin => {
        for (let i = 0; i < 3; i += 1) {
            placeLane(engine, origin[0], origin[1] + i, Direction.UP);
        }
        return laneAt(engine, origin[0], origin[1] + 2);
    });

    engine.setEventSink(event => emitted.push(event));
    for (const lane of lanes) {
        engine.ports.setItem(engine.lanes.inPortOf(lane), CARGO);
    }
    engine.tickAll();

    const batches = emitted.filter(event => event instanceof LaneItemBatchEvent);
    assert.equal(batches.length, 2, "one batch per chunk");
    const near = batches.find(batch => batch.chunk === chunkId(0, 0));
    assert.equal(near.upsertLaneRefs.length, 2, "both near lanes ingested into one batch");
    assert.deepEqual(near.upsertItemTypeIds, [CARGO, CARGO]);
});

// The out-port's resting item is an ordinary rendered port item.
test("a lane emits a port-item set when an item pops to its out-port", async () => {
    const engine = await setup();
    const collector = new EventCollector(engine);
    for (const y of [0, 1, 2]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const lane = laneAt(engine, 0, 2);
    collector.drain();

    engine.ports.setItem(engine.lanes.inPortOf(lane), CARGO);
    const sets = [];
    for (let i = 0; i < 8; i += 1) {
        engine.tickAll();
        for (const event of collector.drain()) {
            if (event instanceof PortItemSetEvent) {
                sets.push(event);
            }
        }
    }

    assert.equal(sets.length, 1);
    assert.equal(sets[0].portId, engine.lanes.outPortOf(lane));
    assert.equal(sets[0].itemTypeId, CARGO);
});

// Deleting the tail strands its out-port; the sweep must still emit the clear, or the client's
// resting sprite leaks.
test("deleting the tail cell emits a port-item clear for the stranded out-port", async () => {
    const engine = await setup();
    const collector = new EventCollector(engine);
    for (const y of [0, 1, 2]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const lane = laneAt(engine, 0, 2);
    const outPort = engine.lanes.outPortOf(lane);
    engine.ports.setItem(engine.lanes.inPortOf(lane), CARGO);
    for (let i = 0; i < 8; i += 1) {
        engine.tickAll();
    }
    collector.drain();

    deleteLane(engine, 0, 0);
    engine.ports.collectUnreferenced();

    const clears = collector.drain().filter(event => event instanceof PortItemClearEvent);
    assert.equal(clears.length, 1);
    assert.equal(clears[0].portId, outPort);
});

// The client places items against the lane geometry it was last told, so a rebuild must send the
// geometry before any item row, and clear the out-port it moved away from.
test("a downstream extension emits geometry before item rows and clears the old out-port", async () => {
    const engine = await setup();
    const collector = new EventCollector(engine);
    for (const y of [3, 4, 5]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const lane = laneAt(engine, 0, 5);
    const oldOutPort = engine.lanes.outPortOf(lane);
    engine.ports.setItem(engine.lanes.inPortOf(lane), CARGO);
    for (let i = 0; i < 10 && engine.ports.item(oldOutPort) !== CARGO; i += 1) {
        engine.tickAll();
    }
    collector.drain();

    placeLane(engine, 0, 2, Direction.UP);
    const events = collector.drain();

    const geometryAt = events.findIndex(event => event instanceof LaneGeometryEvent);
    // Re-synced items snap rather than glide: the edit did not move them.
    const firstRowAt = events.findIndex(event => event instanceof LaneItemSyncEvent);
    assert.ok(geometryAt >= 0 && firstRowAt >= 0, "both a geometry event and item rows are emitted");
    assert.ok(geometryAt < firstRowAt, "the geometry precedes the item rows");

    engine.tickAll();
    const cleared = events.concat(collector.drain()).some(event =>
        event instanceof PortItemClearEvent && event.portId === oldOutPort);
    assert.ok(cleared, "the old out-port's resting sprite is cleared");
});

// A head extension does not move the out-port, so its resting item must emit neither a clear nor a
// set: a clear plus set would glide a fresh sprite in, a lone clear would drop it.
test("extending a lane upstream leaves a resting out-port item static", async () => {
    const engine = await setup();
    const collector = new EventCollector(engine);
    for (const y of [3, 4, 5]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const outPort = engine.lanes.outPortOf(laneAt(engine, 0, 5));
    engine.ports.setItem(engine.lanes.inPortOf(laneAt(engine, 0, 5)), CARGO);
    for (let i = 0; i < 10 && engine.ports.item(outPort) !== CARGO; i += 1) {
        engine.tickAll();
    }
    assert.equal(engine.ports.item(outPort), CARGO, "the item rests in the out-port");
    collector.drain();

    placeLane(engine, 0, 6, Direction.UP);
    const editEvents = collector.drain();
    engine.tickAll();
    const tickEvents = collector.drain();

    assert.equal(engine.ports.item(outPort), CARGO, "the item is still in the out-port");
    const churned = editEvents.concat(tickEvents).some(event =>
        (event instanceof PortItemClearEvent || event instanceof PortItemSetEvent) && event.portId === outPort);
    assert.ok(!churned, "the surviving out-port emits no clear or set, so its sprite stays put");
});
