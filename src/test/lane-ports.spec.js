import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {ModPackage} from "@/common/ModPackage.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {TestMachineType, MachineFixtureDeclaration, ITEM_TYPE_TEST_MACHINE_INPUT} from "@/test/machineFixture.js";
import {
    LaneFixtureDeclaration,
    placeLane,
    laneAt,
} from "@/test/laneFixture.js";

async function setup() {
    return makeGameEngine([
        new ModPackage(new LaneFixtureDeclaration()),
        new ModPackage(new MachineFixtureDeclaration()),
    ]);
}

// One shared port per tile edge, so an object's port and the adjacent lane's port coincide.
test("a lane's in and out ports are the shared edge ports a neighbor would adopt", async () => {
    const engine = await setup();
    for (const y of [0, 1, 2]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const lane = laneAt(engine, 0, 2);

    assert.equal(engine.lanes.inPortOf(lane), engine.ports.at(0, 2, Direction.UP), "in-port = the head tile's back edge");
    assert.equal(engine.lanes.outPortOf(lane), engine.ports.at(0, -1, Direction.UP), "out-port = the edge past the tail");
});

// A machine placed on the tile a lane feeds adopts the same port with no wiring, and takes the item.
test("a machine placed at a lane's output adopts its out-port and receives items", async () => {
    const engine = await setup();
    placeLane(engine, 5, 6, Direction.UP);
    const lane = laneAt(engine, 5, 6);
    const outPort = engine.lanes.outPortOf(lane);

    engine.applyMessage(new CreateObjectMessage(TestMachineType.typeId, 5, 5, Direction.UP));

    assert.equal(engine.ports.at(5, 5, Direction.UP), outPort, "the machine's input is the lane's out-port");

    engine.ports.setItem(engine.lanes.inPortOf(lane), ITEM_TYPE_TEST_MACHINE_INPUT);
    let taken = false;
    for (let i = 0; i < 12 && !taken; i += 1) {
        engine.tickAll();
        taken = engine.lanes.itemCountOf(lane) === 0 && engine.ports.item(outPort) !== ITEM_TYPE_TEST_MACHINE_INPUT;
    }
    assert.ok(taken, "the item crossed the lane and the machine took it");
});

// Both of a lane's ports are pinned: the sweep for unreferenced ports must not collect them.
test("a lane's ports survive the unreferenced-port sweep", async () => {
    const engine = await setup();
    for (const y of [0, 1, 2]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const lane = laneAt(engine, 0, 2);
    const inPort = engine.lanes.inPortOf(lane);
    const outPort = engine.lanes.outPortOf(lane);

    engine.ports.collectUnreferenced();

    assert.equal(engine.lanes.inPortOf(lane), inPort, "the in-port survived");
    assert.equal(engine.lanes.outPortOf(lane), outPort, "the out-port survived");
    assert.equal(engine.ports.at(0, 2, Direction.UP), inPort, "and is still the tile edge's shared port");
});
