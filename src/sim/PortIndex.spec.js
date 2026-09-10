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
    const machine = engine.placed.getEidsByTypeId(TestMachineType.objectTypeId)[0];
    const inputPort = engine.ports.getPortEidAt(5, 5, Direction.UP);
    const outputPort = engine.ports.getPortEidAt(5, 4, Direction.UP);

    assert.deepEqual(engine.ports.getConsumerEidsByPortEid(inputPort), [machine], "the machine consumes its input edge");
    assert.deepEqual(engine.ports.getProducerEidsByPortEid(outputPort), [machine], "and produces into its output edge");
    assert.deepEqual(engine.ports.getProducerEidsByPortEid(inputPort), [], "nothing produces into its input yet");

    engine.applyMessage(new CreateObjectMessage(TestLaneType.objectTypeId, 5, 4, Direction.UP));
    const cell = engine.placed.getEidsByTypeId(TestLaneType.objectTypeId)[0];
    assert.deepEqual(engine.ports.getConsumerEidsByPortEid(outputPort), [cell], "the cell across the edge consumes the machine's output");

    engine.applyMessage(new DeleteObjectMessage(engine.placed.getObjectRefByEid(machine)));
    assert.deepEqual(engine.ports.getProducerEidsByPortEid(outputPort), [], "the deleted machine is unbound");
    assert.deepEqual(engine.ports.getConsumerEidsByPortEid(outputPort), [cell], "the cell is still bound");
});

test("endpoints are rebuilt after a load", async () => {
    const a = await setup();
    a.applyMessage(new CreateObjectMessage(TestMachineType.objectTypeId, 5, 5, Direction.UP));
    const snapshot = JSON.parse(JSON.stringify(a.snapshots.serialize()));

    const b = await setup();
    b.snapshots.deserialize(snapshot);
    const machine = b.placed.getEidsByTypeId(TestMachineType.objectTypeId)[0];

    assert.deepEqual(b.ports.getProducerEidsByPortEid(b.ports.getPortEidAt(5, 4, Direction.UP)), [machine]);
});

// An interior lane edge (a flank turn between two cells) is no component's stored eid field, but it
// is still a live producer/consumer binding. collectUnreferenced, fired by any unrelated delete,
// must keep it, or the next lane rebuild reads an emptied edge and detaches the run.
test("the sweep keeps a port that a live object still produces into or consumes from", async () => {
    const engine = await setup();
    // A cell at (5,5) UP feeding the flank of a cell at (5,4) RIGHT: their shared edge is (5,4) UP,
    // an interior turn edge stored in no eid field.
    engine.applyMessage(new CreateObjectMessage(TestLaneType.objectTypeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(TestLaneType.objectTypeId, 5, 4, Direction.RIGHT));
    const feeder = engine.placed.getEidsByTypeId(TestLaneType.objectTypeId)[0];
    const turn = engine.placed.getEidsByTypeId(TestLaneType.objectTypeId)[1];
    const edge = engine.ports.getPortEidAt(5, 4, Direction.UP);
    assert.deepEqual(engine.ports.getProducerEidsByPortEid(edge), [feeder], "the feeder produces into the turn edge");
    assert.deepEqual(engine.ports.getConsumerEidsByPortEid(edge), [turn], "the turn cell consumes it");

    // A delete somewhere else fires the global sweep; the still-bound interior edge must survive.
    engine.applyMessage(new CreateObjectMessage(TestMachineType.objectTypeId, 20, 20, Direction.UP));
    engine.applyMessage(new DeleteObjectMessage(engine.placed.getObjectRefByEid(
        engine.placed.getEidsByTypeId(TestMachineType.objectTypeId)[0])));

    assert.equal(engine.ports.getPortEidAt(5, 4, Direction.UP), edge, "the interior edge port keeps its identity");
    assert.deepEqual(engine.ports.getProducerEidsByPortEid(edge), [feeder], "and its bindings survive the sweep");
    assert.deepEqual(engine.ports.getConsumerEidsByPortEid(edge), [turn]);
});
