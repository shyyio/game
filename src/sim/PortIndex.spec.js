import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {ModPackage} from "@/common/ModPackage.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {TestMachineType, MachineFixtureDeclaration} from "@/test/machineFixture.js";
import {LaneFixtureDeclaration, TestLaneType} from "@/test/laneFixture.js";

async function setup() {
    return makeGameEngine([
        new ModPackage(new MachineFixtureDeclaration()),
        new ModPackage(new LaneFixtureDeclaration()),
    ]);
}

// A placed object's declared ports bind it as the producer of its outputs and the consumer of its
// inputs, so a neighbor asks the port who stands on the other side instead of scanning tiles.
test("placing an object binds it to its ports' endpoints, deleting it unbinds", async () => {
    const engine = await setup();
    engine.applyMessage(new CreateObjectMessage(TestMachineType.objectTypeId, 5, 5, Direction.UP));
    const machine = engine.placed.eidsOf(TestMachineType.objectTypeId)[0];
    const inPort = engine.ports.at(5, 5, Direction.UP);
    const outPort = engine.ports.at(5, 4, Direction.UP);

    assert.deepEqual(engine.ports.consumersOf(inPort), [machine], "the machine consumes its input edge");
    assert.deepEqual(engine.ports.producersOf(outPort), [machine], "and produces into its output edge");
    assert.deepEqual(engine.ports.producersOf(inPort), [], "nothing produces into its input yet");

    engine.applyMessage(new CreateObjectMessage(TestLaneType.objectTypeId, 5, 4, Direction.UP));
    const cell = engine.placed.eidsOf(TestLaneType.objectTypeId)[0];
    assert.deepEqual(engine.ports.consumersOf(outPort), [cell], "the cell across the edge consumes the machine's output");

    engine.applyMessage(new DeleteObjectMessage(engine.placed.objectRefOf(machine)));
    assert.deepEqual(engine.ports.producersOf(outPort), [], "the deleted machine is unbound");
    assert.deepEqual(engine.ports.consumersOf(outPort), [cell], "the cell is still bound");
});

test("endpoints are rebuilt after a load", async () => {
    const a = await setup();
    a.applyMessage(new CreateObjectMessage(TestMachineType.objectTypeId, 5, 5, Direction.UP));
    const snapshot = JSON.parse(JSON.stringify(a.snapshots.serialize()));

    const b = await setup();
    b.snapshots.deserialize(snapshot);
    const machine = b.placed.eidsOf(TestMachineType.objectTypeId)[0];

    assert.deepEqual(b.ports.producersOf(b.ports.at(5, 4, Direction.UP)), [machine]);
});
