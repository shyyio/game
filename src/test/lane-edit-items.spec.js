import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {EMPTY} from "@/sim/sentinels.js";
import {ModPackage} from "@/common/ModPackage.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {
    LaneFixtureDeclaration,
    ITEM_TYPE_TEST_CARGO,
    placeLane,
    deleteLane,
    laneAt,
    itemCells,
} from "@/test/laneFixture.js";

const CARGO = ITEM_TYPE_TEST_CARGO;

async function setup() {
    return makeGameEngine([new ModPackage(new LaneFixtureDeclaration())]);
}

// Runs the lane with its out-port drained every tick and counts what pops out.
function drain(engine, laneRef, ticks) {
    let delivered = 0;
    for (let i = 0; i < ticks; i += 1) {
        engine.ports.setItem(engine.lanes.outPortOf(laneRef), EMPTY);
        engine.tickAll();
        if (engine.ports.item(engine.lanes.outPortOf(laneRef)) === CARGO) {
            delivered += 1;
        }
    }
    return delivered;
}

// Extending at the output edge must not drop an item in flight: the new cell is empty space ahead
// of it, so it keeps travelling to the moved out-port.
test("extending a lane downstream preserves an in-flight item", async () => {
    const engine = await setup();
    for (const y of [3, 4, 5]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    engine.ports.setItem(engine.lanes.inPortOf(laneAt(engine, 0, 5)), CARGO);
    engine.tickAll();
    engine.tickAll();
    assert.equal(itemCells(engine), 1, "the item is in flight before the extension");

    placeLane(engine, 0, 2, Direction.UP);

    assert.equal(drain(engine, laneAt(engine, 0, 5), 16), 1, "the in-flight item is delivered after the extension");
});

// An item that has already popped and rests in the out-port must not vanish when the tail moves: it
// re-enters the lane at that slot.
test("extending a lane downstream preserves an item resting in the out-port", async () => {
    const engine = await setup();
    for (const y of [3, 4, 5]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    let lane = laneAt(engine, 0, 5);
    engine.ports.setItem(engine.lanes.inPortOf(lane), CARGO);
    for (let i = 0; i < 10 && engine.ports.item(engine.lanes.outPortOf(lane)) !== CARGO; i += 1) {
        engine.tickAll();
    }
    assert.equal(engine.ports.item(engine.lanes.outPortOf(lane)), CARGO, "the item rests in the out-port");

    placeLane(engine, 0, 2, Direction.UP);

    lane = laneAt(engine, 0, 5);
    assert.equal(drain(engine, lane, 16), 1, "the resting out-port item is delivered after the extension");
});

// The client places items against the lane's length and keys the resting out-port sprite by port ref,
// so item rows must stay ordered by ascending id from the output edge after a rebuild.
test("a tail extension keeps item rows ordered output-to-input", async () => {
    const engine = await setup();
    for (const y of [3, 4, 5]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    engine.ports.setItem(engine.lanes.inPortOf(laneAt(engine, 0, 5)), CARGO);
    engine.tickAll();
    engine.tickAll();

    placeLane(engine, 0, 2, Direction.UP);

    const items = engine.lanes.itemsOf(laneAt(engine, 0, 5));
    const ascending = items.every((item, index) => index === 0 || items[index - 1].itemRef < item.itemRef);
    assert.ok(ascending, `item ids must ascend output->input, got ${items.map(item => String(item.itemRef))}`);
});

// A deletion that splits a lane re-rows the surviving sub-run's items from slot occupancy. Packed
// same-type items must survive that round trip as separate items and pop one per tick.
test("packed same-type items survive a split and each still pops", async () => {
    const engine = await setup();
    for (const y of [0, 1, 2, 3]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const fed = laneAt(engine, 0, 3);
    for (let i = 0; i < 12; i += 1) {
        engine.ports.setItem(engine.lanes.inPortOf(fed), CARGO);
        engine.tickAll();
    }

    deleteLane(engine, 0, 1);

    const sub = laneAt(engine, 0, 3);
    const expected = engine.lanes.itemsOf(sub).filter(item => item.itemTypeId === CARGO).length;
    assert.ok(expected >= 2, "the split sub-run carries at least two packed items");

    engine.ports.setItem(engine.lanes.inPortOf(sub), EMPTY);
    assert.equal(drain(engine, sub, 12), expected, "every packed item pops; none are lost to a collapsed run");
});

// Items on cells orphaned by a junction steal carry onto the rebuilt lane rather than being
// discarded to an empty rebuild.
test("items on cells orphaned by a junction steal survive the rebuild", async () => {
    const engine = await setup();
    for (const y of [7, 6, 5, 4]) {
        placeLane(engine, 5, y, Direction.UP);
    }
    const fed = laneAt(engine, 5, 7);
    for (let i = 0; i < 16; i += 1) {
        engine.ports.setItem(engine.lanes.inPortOf(fed), CARGO);
        engine.tickAll();
    }

    placeLane(engine, 4, 5, Direction.RIGHT); // newer candidate into (5,5) wins its junction

    const orphan = laneAt(engine, 5, 7);
    const expected = engine.lanes.itemsOf(orphan).filter(item => item.itemTypeId === CARGO).length;
    assert.ok(expected >= 2, "the orphaned lane carries the packed items");

    engine.ports.setItem(engine.lanes.inPortOf(orphan), EMPTY);
    assert.equal(drain(engine, orphan, 12), expected, "every orphaned item pops");
});

test("an in-flight item survives deletion of a downstream cell and is still delivered", async () => {
    const engine = await setup();
    for (const y of [4, 3, 2, 1, 0]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    engine.ports.setItem(engine.lanes.inPortOf(laneAt(engine, 0, 4)), CARGO);
    engine.tickAll();
    engine.tickAll();
    assert.equal(itemCells(engine), 1, "the item is in flight on an upstream cell");

    deleteLane(engine, 0, 0);

    assert.equal(itemCells(engine), 1, "the item is kept after the downstream cell is deleted");
    assert.equal(drain(engine, laneAt(engine, 0, 4), 12), 1, "and is still delivered to the shortened lane's out-port");
});

test("an in-flight item survives deletion of an upstream cell", async () => {
    const engine = await setup();
    for (const y of [4, 3, 2, 1, 0]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    engine.ports.setItem(engine.lanes.inPortOf(laneAt(engine, 0, 4)), CARGO);
    for (let i = 0; i < 5; i += 1) {
        engine.tickAll();
    }
    assert.equal(itemCells(engine), 1, "the item is in flight downstream");

    deleteLane(engine, 0, 4);

    assert.equal(itemCells(engine), 1, "the downstream item is kept after the head cell is deleted");
});

// Filling a gap folds two lanes into one and keeps the upstream lane's in-flight item.
test("filling a gap to merge two lanes keeps the source's in-flight item", async () => {
    const engine = await setup();
    placeLane(engine, 12, 6, Direction.UP);
    placeLane(engine, 12, 4, Direction.UP);
    engine.ports.setItem(engine.lanes.inPortOf(laneAt(engine, 12, 6)), CARGO);
    engine.tickAll();
    assert.equal(itemCells(engine), 1, "the item rests on the source cell");

    placeLane(engine, 12, 5, Direction.UP);

    assert.equal(engine.lanes.ids().length, 1, "the two lanes fold into one");
    assert.equal(itemCells(engine), 1, "the item is kept through the merge");
    assert.equal(drain(engine, laneAt(engine, 12, 6), 10), 1, "the merged item is still delivered");
});

// The downstream lane's in-port becomes interior when the gap is filled, so an item resting there
// re-enters the lane rather than being stranded.
test("filling a gap to merge two lanes keeps an item resting in the sink's in-port", async () => {
    const engine = await setup();
    placeLane(engine, 12, 6, Direction.UP);
    placeLane(engine, 12, 4, Direction.UP);
    engine.ports.setItem(engine.lanes.inPortOf(laneAt(engine, 12, 4)), CARGO);

    placeLane(engine, 12, 5, Direction.UP);

    assert.equal(itemCells(engine), 1, "the sink's in-port item re-materializes on the lane");
    assert.equal(drain(engine, laneAt(engine, 12, 6), 10), 1, "the re-materialized item is delivered");
});

// A tail merge makes the old out-port interior, so its resting item re-enters at that slot and the
// old port is cleared rather than carried a tile forward.
test("a tail merge re-ingests a resting out-port item onto the connecting cell", async () => {
    const engine = await setup();
    placeLane(engine, 0, 0, Direction.RIGHT);
    placeLane(engine, 1, 0, Direction.RIGHT);
    placeLane(engine, 2, 0, Direction.RIGHT);
    placeLane(engine, 4, 0, Direction.RIGHT);
    const oldOutPort = engine.lanes.outPortOf(laneAt(engine, 0, 0));
    engine.ports.setItem(oldOutPort, CARGO);

    placeLane(engine, 3, 0, Direction.RIGHT);

    assert.equal(engine.ports.item(oldOutPort), EMPTY, "the old out-port is cleared");
    assert.equal(itemCells(engine), 1, "the item re-ingests onto the lane");
    assert.equal(drain(engine, laneAt(engine, 0, 0), 12), 1, "the re-ingested item reaches the merged output");
});
