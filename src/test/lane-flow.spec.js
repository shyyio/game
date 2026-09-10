import {EMPTY} from "@/sim/AbstractComponent.js";
import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction, LAYER_SURFACE} from "@/common/constants.js";
import {ModPackage} from "@/common/ModPackage.js";
import {makeGameEngine, ProbeSystem} from "@/test/ecsSim.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {TestMachineType, MachineFixtureDeclaration} from "@/test/machineFixture.js";
import {
    LaneFixtureDeclaration,
    ITEM_TYPE_TEST_CARGO,
    ITEM_TYPE_TEST_CARGO_B,
    ITEM_TYPE_TEST_FLUID,
    placeLane,
    deleteLane,
    getLaneRefAt,
    itemCells,
} from "@/test/laneFixture.js";

const CARGO = ITEM_TYPE_TEST_CARGO;
const OTHER = ITEM_TYPE_TEST_CARGO_B;
const FLUID = ITEM_TYPE_TEST_FLUID;

async function setup() {
    return makeGameEngine([
        new ModPackage(new LaneFixtureDeclaration()),
        new ModPackage(new MachineFixtureDeclaration()),
    ]);
}

// Places a machine and returns its output port, so the lane topology sees a real producer.
function placeProducer(engine, tileX, tileY, direction) {
    engine.applyMessage(new CreateObjectMessage(TestMachineType.objectTypeId, tileX, tileY, direction));
    return engine.getPortAt(TestMachineType.outputPorts[0], tileX, tileY, direction).port;
}

// Two items fed into a three-cell lane arrive at the tail two ticks apart, one slot per tick.
test("a lane carries fed items to its output port one slot per tick", async () => {
    const engine = await setup();
    for (const y of [0, 1, 2]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const lane = getLaneRefAt(engine, 0, 2);
    const stream = [];
    for (let i = 0; i < 10; i += 1) {
        engine.ports.setItem(engine.lanes.getOutputPortEidByLaneRef(lane), EMPTY);
        if (i < 2) {
            engine.ports.setItem(engine.lanes.getInputPortEidByLaneRef(lane), CARGO);
        }
        engine.tick();
        stream.push(engine.ports.getItemByPortEid(engine.lanes.getOutputPortEidByLaneRef(lane)));
    }
    assert.deepEqual(stream, [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, CARGO, CARGO, EMPTY, EMPTY, EMPTY]);
});

// A lane bending out of a producer's output takes the feed on its flank edge, not its straight one.
test("a lane head ingests a producer feeding its flank", async () => {
    const engine = await setup();
    placeLane(engine, 5, 4, Direction.UP);
    placeLane(engine, 5, 5, Direction.UP);
    const producerOut = placeProducer(engine, 4, 5, Direction.RIGHT);
    engine.ports.setItem(producerOut, CARGO);

    let drained = false;
    for (let i = 0; i < 8 && !drained; i += 1) {
        engine.tick();
        drained = engine.ports.getItemByPortEid(producerOut) === EMPTY;
    }

    assert.ok(drained, "the producer's output port emptied into the lane");
    assert.equal(itemCells(engine), 1, "the item rides the lane");
});

// A lane has one input, its head's parent edge; every other port on the head is inert. A machine on
// the flank of a head whose parent cell lies across the seam backs up, and becomes the parent only
// once that cell is gone.
test("a machine on the flank of a head with a parent cell is inert until that cell is deleted", async () => {
    const engine = await setup();
    placeLane(engine, 0, 63, Direction.UP); // chunk 0: the head, fed across the seam
    placeLane(engine, 0, 64, Direction.UP); // chunk 1: its parent
    const producerOut = placeProducer(engine, -1, 63, Direction.RIGHT);
    engine.ports.setItem(producerOut, CARGO);
    const head = getLaneRefAt(engine, 0, 63);
    assert.equal(engine.lanes.getParentEdgeByCellEid(engine.placed.getEidAt(0, 63, LAYER_SURFACE)), Direction.UP, "fed from behind");

    for (let i = 0; i < 8; i += 1) {
        engine.tick();
    }
    assert.equal(engine.ports.getItemByPortEid(producerOut), CARGO, "the flank feed waits: the head's input is the seam");
    assert.equal(engine.lanes.getItemCountByLaneRef(head), 0);

    deleteLane(engine, 0, 64);

    for (let i = 0; i < 8; i += 1) {
        engine.tick();
    }
    assert.equal(engine.ports.getItemByPortEid(producerOut), EMPTY, "with nothing behind it, the machine is the parent");
    assert.equal(engine.lanes.getParentEdgeByCellEid(engine.placed.getEidAt(0, 63, LAYER_SURFACE)), Direction.RIGHT);
});

// Flanks feed the head cell only: a feeder dead-ending into a cell mid-lane backs up.
test("a feeder into a mid-lane cell's flank backs up", async () => {
    const engine = await setup();
    placeLane(engine, 5, 4, Direction.UP);
    placeLane(engine, 5, 5, Direction.UP);
    placeLane(engine, 5, 6, Direction.UP); // (5,5) is now mid-lane
    const producerOut = placeProducer(engine, 4, 5, Direction.RIGHT);
    engine.ports.setItem(producerOut, CARGO);

    for (let i = 0; i < 8; i += 1) {
        engine.tick();
    }

    assert.equal(engine.ports.getItemByPortEid(producerOut), CARGO, "the feed stays in the producer's port");
    assert.equal(itemCells(engine), 0, "nothing reached the lane");
});

// A fluid resting in the input port is refused, so its producer backs up and the lane stays empty.
test("a lane refuses a resting fluid", async () => {
    const engine = await setup();
    for (const y of [0, 1, 2]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const lane = getLaneRefAt(engine, 0, 2);
    engine.ports.setItem(engine.lanes.getInputPortEidByLaneRef(lane), FLUID);

    for (let i = 0; i < 8; i += 1) {
        engine.tick();
    }

    assert.equal(engine.ports.getItemByPortEid(engine.lanes.getInputPortEidByLaneRef(lane)), FLUID, "the fluid stays put");
    assert.equal(itemCells(engine), 0, "and never enters the lane");
});

// A producer creating into the lane's output port beats the lane's own pop; the lane then keeps its lead
// rather than losing an item nothing carried.
test("a lane losing its output port to another producer keeps its lead", async () => {
    const engine = await setup();
    for (const y of [0, 1]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const lane = getLaneRefAt(engine, 0, 1);
    const outputPort = engine.lanes.getOutputPortEidByLaneRef(lane);
    let contend = false;
    engine.registerSystem(new ProbeSystem({submitIntents: () => {
        if (contend) {
            engine.transfers.submitCreate(outputPort, OTHER, true);
        }
    }}));

    engine.ports.setItem(outputPort, OTHER);
    engine.ports.setItem(engine.lanes.getInputPortEidByLaneRef(lane), CARGO);
    for (let i = 0; i < 8; i += 1) {
        engine.tick();
    }
    assert.equal(engine.lanes.getItemCountByLaneRef(lane), 1);

    engine.ports.setItem(outputPort, EMPTY);
    contend = true;
    engine.tick();

    assert.equal(engine.ports.getItemByPortEid(outputPort), OTHER);
    assert.equal(engine.lanes.getItemCountByLaneRef(lane), 1, "the lead the other producer beat stays on the lane");
});

// A lane ingests only what its own drain took; an input port emptied by anything else carried nothing.
test("a lane does not ingest an input port item something else took", async () => {
    const engine = await setup();
    for (const y of [0, 1]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const lane = getLaneRefAt(engine, 0, 1);
    const inputPort = engine.lanes.getInputPortEidByLaneRef(lane);
    let steal = false;
    engine.registerSystem(new ProbeSystem({order: -1, postResolve: () => {
        if (steal) {
            engine.ports.consumeItem(inputPort);
        }
    }}));

    engine.ports.setItem(engine.lanes.getOutputPortEidByLaneRef(lane), OTHER);
    for (let i = 0; i < 16; i += 1) {
        engine.ports.setItem(inputPort, CARGO);
        engine.tick();
    }
    const packed = engine.lanes.getItemCountByLaneRef(lane);
    engine.ports.setItem(inputPort, CARGO);
    engine.tick();
    assert.equal(engine.ports.getItemByPortEid(inputPort), CARGO, "a packed lane leaves the input port item resting");

    steal = true;
    engine.tick();

    assert.equal(engine.ports.getItemByPortEid(inputPort), EMPTY);
    assert.equal(engine.lanes.getItemCountByLaneRef(lane), packed, "nothing reached the lane");
});

// A lane popping empties its ingest port, so a feeder pushing the next item into that port the same
// tick lands on an empty one. If the pop only marked the port as emptying, the item resting there
// would be overwritten and lost.
test("a feeder never overwrites the input port item of a lane that is popping", async () => {
    const engine = await setup();
    for (const y of [0, 1, 2]) {
        placeLane(engine, 0, y, Direction.UP);
    }
    const lane = getLaneRefAt(engine, 0, 2);
    const inputPort = engine.lanes.getInputPortEidByLaneRef(lane);
    const outputPort = engine.lanes.getOutputPortEidByLaneRef(lane);

    // A producer pushing into the input port even while it is occupied: it resolves on the tick the
    // lane empties that port.
    let intentRow = -1;
    let fed = 0;
    engine.registerSystem(new ProbeSystem({submitIntents: () => {
        intentRow = engine.transfers.submitCreate(inputPort, CARGO, engine.ports.getItemByPortEid(inputPort) === EMPTY);
    }}));
    engine.registerSystem(new ProbeSystem({postResolve: () => {
        if (engine.transfers.isIntentResolved(intentRow)) {
            fed += 1;
        }
    }}));

    // Fill the lane solid against a blocked output port, then drain it every tick.
    engine.ports.setItem(outputPort, OTHER);
    for (let i = 0; i < 12; i += 1) {
        engine.tick();
    }
    let delivered = 0;
    for (let i = 0; i < 24; i += 1) {
        engine.ports.setItem(outputPort, EMPTY);
        engine.tick();
        if (engine.ports.getItemByPortEid(outputPort) === CARGO) {
            delivered += 1;
        }
    }

    const resting = engine.ports.getItemByPortEid(inputPort) === CARGO ? 1 : 0;
    assert.ok(delivered > 0, "items reach the output port");
    assert.equal(delivered + engine.lanes.getItemCountByLaneRef(lane) + resting, fed, "every fed item is still accounted for");
});
