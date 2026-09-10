import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction, CHUNK_SIZE} from "@/common/constants.js";
import {chunkKeyAt} from "@/common/util.js";
import {PortItemSetEvent, PortItemClearEvent} from "@/common/PortItemEvents.js";
import {
    LaneCreatedEvent,
    LaneItemUpsertEvent,
    LaneItemSyncEvent,
    LaneItemDeleteEvent,
    LaneDeletedEvent,
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
    getLaneRefAt,
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
    const lane = getLaneRefAt(engine, 0, 2);
    collector.drain();

    engine.ports.setItem(engine.lanes.getInputPortEidByLaneRef(lane), CARGO);
    const rows = [];
    for (let i = 0; i < 8; i += 1) {
        engine.tick();
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
        return getLaneRefAt(engine, origin[0], origin[1] + 2);
    });

    engine.setEventSink(event => emitted.push(event));
    for (const lane of lanes) {
        engine.ports.setItem(engine.lanes.getInputPortEidByLaneRef(lane), CARGO);
    }
    engine.tick();

    const batches = emitted.filter(event => event instanceof LaneItemBatchEvent);
    assert.equal(batches.length, 2, "one batch per chunk");
    const near = batches.find(batch => batch.chunkKey === chunkKeyAt(0, 0));
    assert.equal(near.upsertLaneRefs.length, 2, "both near lanes ingested into one batch");
    assert.deepEqual(near.upsertItemTypeIds, [CARGO, CARGO]);
});

// The output port's resting item is an ordinary rendered port item.
test("a lane emits a port-item set when an item pops to its output port", async () => {
    const engine = await setup();
    const collector = new EventCollector(engine);
    for (const y of [0, 1, 2]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const lane = getLaneRefAt(engine, 0, 2);
    collector.drain();

    engine.ports.setItem(engine.lanes.getInputPortEidByLaneRef(lane), CARGO);
    const sets = [];
    for (let i = 0; i < 8; i += 1) {
        engine.tick();
        for (const event of collector.drain()) {
            if (event instanceof PortItemSetEvent) {
                sets.push(event);
            }
        }
    }

    assert.equal(sets.length, 1);
    assert.equal(sets[0].portRef, engine.lanes.getOutputPortEidByLaneRef(lane));
    assert.equal(sets[0].itemTypeId, CARGO);
});

// Deleting the tail strands its output port; the sweep must still emit the clear, or the client's
// resting sprite leaks.
test("deleting the tail cell emits a port-item clear for the stranded output port", async () => {
    const engine = await setup();
    const collector = new EventCollector(engine);
    for (const y of [0, 1, 2]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const lane = getLaneRefAt(engine, 0, 2);
    const outputPort = engine.lanes.getOutputPortEidByLaneRef(lane);
    engine.ports.setItem(engine.lanes.getInputPortEidByLaneRef(lane), CARGO);
    for (let i = 0; i < 8; i += 1) {
        engine.tick();
    }
    collector.drain();

    deleteLane(engine, 0, 0);
    engine.ports.collectUnreferenced();

    const clears = collector.drain().filter(event => event instanceof PortItemClearEvent);
    assert.equal(clears.length, 1);
    assert.equal(clears[0].portRef, outputPort);
});

// The client places items against the lane geometry it was last told, so a rebuild must send the
// geometry before any item row, and clear the output port it moved away from.
test("a downstream extension emits geometry before item rows and clears the old output port", async () => {
    const engine = await setup();
    const collector = new EventCollector(engine);
    for (const y of [3, 4, 5]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const lane = getLaneRefAt(engine, 0, 5);
    const oldOutputPort = engine.lanes.getOutputPortEidByLaneRef(lane);
    engine.ports.setItem(engine.lanes.getInputPortEidByLaneRef(lane), CARGO);
    for (let i = 0; i < 10 && engine.ports.getItemByPortEid(oldOutputPort) !== CARGO; i += 1) {
        engine.tick();
    }
    collector.drain();

    placeLane(engine, 0, 2, Direction.UP);
    const events = collector.drain();

    const geometryAt = events.findIndex(event => event instanceof LaneCreatedEvent);
    // Re-synced items snap rather than glide: the edit did not move them.
    const firstRowAt = events.findIndex(event => event instanceof LaneItemSyncEvent);
    assert.ok(geometryAt >= 0 && firstRowAt >= 0, "both a geometry event and item rows are emitted");
    assert.ok(geometryAt < firstRowAt, "the geometry precedes the item rows");

    engine.tick();
    const cleared = events.concat(collector.drain()).some(event =>
        event instanceof PortItemClearEvent && event.portRef === oldOutputPort);
    assert.ok(cleared, "the old output port's resting sprite is cleared");
});

// A head extension does not move the output port, so its resting item must emit neither a clear nor a
// set: a clear plus set would glide a fresh sprite in, a lone clear would drop it.
test("extending a lane upstream leaves a resting output port item static", async () => {
    const engine = await setup();
    const collector = new EventCollector(engine);
    for (const y of [3, 4, 5]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const outputPort = engine.lanes.getOutputPortEidByLaneRef(getLaneRefAt(engine, 0, 5));
    engine.ports.setItem(engine.lanes.getInputPortEidByLaneRef(getLaneRefAt(engine, 0, 5)), CARGO);
    for (let i = 0; i < 10 && engine.ports.getItemByPortEid(outputPort) !== CARGO; i += 1) {
        engine.tick();
    }
    assert.equal(engine.ports.getItemByPortEid(outputPort), CARGO, "the item rests in the output port");
    collector.drain();

    placeLane(engine, 0, 6, Direction.UP);
    const editEvents = collector.drain();
    engine.tick();
    const tickEvents = collector.drain();

    assert.equal(engine.ports.getItemByPortEid(outputPort), CARGO, "the item is still in the output port");
    const churned = editEvents.concat(tickEvents).some(event =>
        (event instanceof PortItemClearEvent || event instanceof PortItemSetEvent) && event.portRef === outputPort);
    assert.ok(!churned, "the surviving output port emits no clear or set, so its sprite stays put");
});

// A rebuilt lane can take the eid of the one it replaces. The client forgets a lane on its reset, so
// that reset must land before the new lane's geometry, or the rows that follow name a lane it dropped.
test("a rebuild's reset for a replaced lane precedes the geometry that reuses its id", async () => {
    const engine = await setup();
    const collector = new EventCollector(engine);
    placeLane(engine, 0, 2, Direction.UP);
    collector.drain();

    placeLane(engine, 0, 1, Direction.UP);
    const events = collector.drain();

    const resets = events.filter(event => event instanceof LaneDeletedEvent);
    assert.ok(resets.length > 0, "the replaced lane is reset");
    for (const reset of resets) {
        const resetAt = events.indexOf(reset);
        const geometryAt = events.findIndex(event =>
            event instanceof LaneCreatedEvent && event.laneRef === reset.laneRef);
        assert.ok(geometryAt === -1 || geometryAt > resetAt, `the reset of lane ${reset.laneRef} precedes its new geometry`);
    }
});

// A rebuild can move an item into a lane's new output port; the client must learn that with the
// rebuild's own rows, or the sprite blinks out for a tick.
test("a rebuild sends the port items it changed along with its rows", async () => {
    const engine = await setup();
    const collector = new EventCollector(engine);
    placeLane(engine, 5, 5, Direction.RIGHT);
    placeLane(engine, 6, 5, Direction.RIGHT);
    const run = getLaneRefAt(engine, 5, 5);
    engine.ports.setItem(engine.lanes.getOutputPortEidByLaneRef(run), 2);
    for (let i = 0; i < 6; i += 1) {
        engine.ports.setItem(engine.lanes.getInputPortEidByLaneRef(run), CARGO);
        engine.tick();
    }
    collector.drain();

    // A junction steal orphans (5,5); its boundary item lands in its new output port.
    placeLane(engine, 6, 6, Direction.UP);
    const events = collector.drain();

    const orphanOut = engine.lanes.getOutputPortEidByLaneRef(getLaneRefAt(engine, 5, 5));
    assert.equal(engine.ports.getItemByPortEid(orphanOut), CARGO);
    assert.ok(
        events.some(event => event instanceof PortItemSetEvent && event.portRef === orphanOut && event.itemTypeId === CARGO),
        "the new output port's item is sent with the rebuild",
    );
});
