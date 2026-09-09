import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction, CHUNK_SIZE} from "@/common/constants.js";
import {EMPTY} from "@/sim/sentinels.js";
import {ModPackage} from "@/common/ModPackage.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {
    LaneFixtureDeclaration,
    ITEM_TYPE_TEST_CARGO,
    placeLane,
    laneAt,
} from "@/test/laneFixture.js";

const CARGO = ITEM_TYPE_TEST_CARGO;

async function setup() {
    return makeGameEngine([new ModPackage(new LaneFixtureDeclaration())]);
}

// A lane never crosses a chunk border: the run splits into per-chunk lanes joined at the seam port,
// and items still flow across it.
test("a run splits at the chunk border and items flow across the seam", async () => {
    const engine = await setup();
    for (const y of [62, 63, 64, 65]) {
        placeLane(engine, 0, y, Direction.UP);
    }

    const upstream = laneAt(engine, 0, 65);
    const downstream = laneAt(engine, 0, 63);
    assert.notEqual(upstream, downstream, "the run is two per-chunk lanes");
    assert.equal(
        engine.lanes.outPortOf(upstream),
        engine.lanes.inPortOf(downstream),
        "they are joined by one shared seam port",
    );

    const inPort = engine.lanes.inPortOf(upstream);
    const outPort = engine.lanes.outPortOf(downstream);
    const outStream = [];
    for (let i = 0; i < 24; i += 1) {
        engine.ports.setItem(outPort, EMPTY);
        if (i < 3) {
            engine.ports.setItem(inPort, CARGO);
        }
        engine.tickAll();
        outStream.push(engine.ports.item(outPort));
    }

    assert.equal(outStream.filter(item => item === CARGO).length, 3, "all three items crossed the seam");
});

// A run bending exactly on a seam becomes two lanes whose shared edge port faces the upstream one.
test("a run bending on a chunk seam carries items across it", async () => {
    const engine = await setup();
    const seam = CHUNK_SIZE;
    placeLane(engine, seam - 2, 5, Direction.RIGHT);
    placeLane(engine, seam - 1, 5, Direction.RIGHT);
    placeLane(engine, seam, 5, Direction.UP);
    placeLane(engine, seam, 4, Direction.UP);

    const upstream = laneAt(engine, seam - 2, 5);
    const downstream = laneAt(engine, seam, 5);
    assert.notEqual(upstream, downstream, "the seam split the run in two");

    engine.ports.setItem(engine.lanes.inPortOf(upstream), CARGO);
    let carried = false;
    for (let i = 0; i < 16 && !carried; i += 1) {
        engine.tickAll();
        carried = engine.lanes.itemsOf(downstream).some(item => item.itemTypeId === CARGO);
    }

    assert.ok(carried, "the item crossed the seam into the bent lane");
    assert.equal(engine.lanes.itemCountOf(upstream), 0, "and left the upstream lane");
});

// A packed run shifts as one: the downstream lane taking an item frees the upstream lane's pop in
// the same tick, so a full chain advances every tick rather than every other one.
test("a packed chain across a seam shifts in one tick", async () => {
    const engine = await setup();
    for (const y of [62, 63, 64, 65]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const upstream = laneAt(engine, 0, 65);
    const downstream = laneAt(engine, 0, 63);
    const inPort = engine.lanes.inPortOf(upstream);
    const outPort = engine.lanes.outPortOf(downstream);

    // Fill both lanes solid against a blocked out-port.
    engine.ports.setItem(outPort, CARGO);
    for (let i = 0; i < 16; i += 1) {
        engine.ports.setItem(inPort, CARGO);
        engine.tickAll();
    }
    // The seam port is one slot of the chain, so an item resting there is packed like any other.
    const seam = engine.lanes.outPortOf(upstream);
    const packed = engine.lanes.itemCountOf(upstream) + engine.lanes.itemCountOf(downstream)
        + (engine.ports.item(seam) === CARGO ? 1 : 0);

    // Drain the out-port every tick: the whole chain advances, one item per tick, none lost.
    let delivered = 0;
    for (let i = 0; i < 24; i += 1) {
        engine.ports.setItem(outPort, EMPTY);
        engine.ports.setItem(inPort, EMPTY);
        engine.tickAll();
        if (engine.ports.item(outPort) === CARGO) {
            delivered += 1;
        }
    }

    assert.equal(delivered, packed, "every packed item crossed the seam and popped");
});
