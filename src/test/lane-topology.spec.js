import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction, LAYER_SURFACE} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {EMPTY, NO_EID} from "@/sim/sentinels.js";
import {ModPackage} from "@/common/ModPackage.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {TestMachineType, MachineFixtureDeclaration} from "@/test/machineFixture.js";
import {
    LaneFixtureDeclaration,
    TestLaneDownType,
    ITEM_TYPE_TEST_CARGO,
    placeLane,
    deleteLane,
    laneAt,
    laneTiles,
} from "@/test/laneFixture.js";

const CARGO = ITEM_TYPE_TEST_CARGO;

async function setup() {
    return makeGameEngine([
        new ModPackage(new LaneFixtureDeclaration()),
        new ModPackage(new MachineFixtureDeclaration()),
    ]);
}

// A 3x3 ring of cells, clockwise from the top-left.
function buildRing3x3(engine) {
    const cells = [
        [0, 0, Direction.RIGHT], [1, 0, Direction.RIGHT], [2, 0, Direction.DOWN], [2, 1, Direction.DOWN],
        [2, 2, Direction.LEFT], [1, 2, Direction.LEFT], [0, 2, Direction.UP], [0, 1, Direction.UP],
    ];
    for (const cell of cells) {
        placeLane(engine, cell[0], cell[1], cell[2]);
    }
}

// A straight run of same-direction cells is one lane; the head is the most upstream cell and the
// output port sits past the tail. Two slots per cell, less the tail's last slot (the port itself).
test("a straight run builds one lane of the right length", async () => {
    const engine = await setup();
    placeLane(engine, 0, 0, Direction.RIGHT);
    placeLane(engine, 1, 0, Direction.RIGHT);
    placeLane(engine, 2, 0, Direction.RIGHT);

    assert.equal(engine.lanes.ids().length, 1);
    const lane = laneAt(engine, 0, 0);
    assert.deepEqual(laneTiles(engine, lane), [[0, 0], [1, 0], [2, 0]]);
    assert.equal(engine.lanes.lengthOf(lane), 3 * 2 - 1);
});

// Placing a cell that feeds the middle of a run steals the downstream: its lane bends through the
// junction to the old tail, and the upstream is left a shorter lane.
test("a cell feeding a run's middle splits it and steals the downstream", async () => {
    const engine = await setup();
    placeLane(engine, 0, 0, Direction.RIGHT);
    placeLane(engine, 1, 0, Direction.RIGHT);
    placeLane(engine, 2, 0, Direction.RIGHT);

    placeLane(engine, 1, 2, Direction.UP);
    placeLane(engine, 1, 1, Direction.UP);

    const stolen = laneAt(engine, 2, 0);
    assert.deepEqual(
        laneTiles(engine, stolen),
        [[1, 2], [1, 1], [1, 0], [2, 0]],
        "the new cell bends through the junction to the old tail",
    );
    assert.equal(engine.lanes.lengthOf(stolen), 4 * 2 - 1);

    const upstream = laneAt(engine, 0, 0);
    assert.deepEqual(laneTiles(engine, upstream), [[0, 0]], "the upstream cell is left on its own shorter lane");
    assert.equal(engine.lanes.lengthOf(upstream), 1);
});

// A resting output port item belongs to whichever lane owns the tail, so a split hands it over.
test("a split hands a resting output port item to the stolen downstream lane", async () => {
    const engine = await setup();
    placeLane(engine, 0, 0, Direction.RIGHT);
    placeLane(engine, 1, 0, Direction.RIGHT);
    placeLane(engine, 2, 0, Direction.RIGHT);
    engine.ports.setItem(engine.lanes.outputPortOf(laneAt(engine, 0, 0)), CARGO);

    placeLane(engine, 1, 2, Direction.UP);
    placeLane(engine, 1, 1, Direction.UP);

    const stolen = laneAt(engine, 2, 0);
    const upstream = laneAt(engine, 0, 0);
    assert.equal(engine.ports.item(engine.lanes.outputPortOf(stolen)), CARGO, "the item stays in the tail's output port");
    assert.equal(engine.ports.item(engine.lanes.outputPortOf(upstream)), EMPTY, "the shortened lane's output port is empty");
});

// Prepending an upstream cell is a head extension: the output port does not move, so a resting item stays.
test("prepending an upstream cell keeps a resting output port item", async () => {
    const engine = await setup();
    placeLane(engine, 1, 0, Direction.RIGHT);
    engine.ports.setItem(engine.lanes.outputPortOf(laneAt(engine, 1, 0)), CARGO);

    placeLane(engine, 0, 0, Direction.RIGHT);

    const lane = laneAt(engine, 1, 0);
    assert.deepEqual(laneTiles(engine, lane), [[0, 0], [1, 0]]);
    assert.equal(engine.ports.item(engine.lanes.outputPortOf(lane)), CARGO, "the output port item survives the prepend");
});

// A bent lane is one contiguous run through the corner; an item flows around it to the output port.
test("an item flows around a bend to the output port", async () => {
    const engine = await setup();
    placeLane(engine, 0, 0, Direction.RIGHT);
    placeLane(engine, 1, 0, Direction.RIGHT);
    placeLane(engine, 2, 0, Direction.UP);
    const lane = laneAt(engine, 0, 0);
    assert.deepEqual(laneTiles(engine, lane), [[0, 0], [1, 0], [2, 0]], "the corner cell joins the same lane");

    engine.ports.setItem(engine.lanes.inputPortOf(lane), CARGO);
    let delivered = 0;
    for (let i = 0; i < 12; i += 1) {
        engine.ports.setItem(engine.lanes.outputPortOf(lane), EMPTY);
        engine.tick();
        if (engine.ports.item(engine.lanes.outputPortOf(lane)) === CARGO) {
            delivered += 1;
        }
    }
    assert.equal(delivered, 1, "the item is delivered around the bend");
});

// A closed loop is one lane whose two ends are the same port, and an item laps it forever.
test("a closed loop is one lane sharing one port, and an item circulates", async () => {
    const engine = await setup();
    placeLane(engine, 0, 0, Direction.RIGHT);
    placeLane(engine, 1, 0, Direction.DOWN);
    placeLane(engine, 1, 1, Direction.LEFT);
    placeLane(engine, 0, 1, Direction.UP);

    assert.equal(engine.lanes.ids().length, 1);
    const lane = laneAt(engine, 0, 0);
    assert.equal(engine.lanes.lengthOf(lane), 4 * 2 - 1);
    const port = engine.lanes.outputPortOf(lane);
    assert.equal(engine.lanes.inputPortOf(lane), port, "the loop shares one port for both ends");

    engine.ports.setItem(port, CARGO);
    let rests = 0;
    for (let i = 0; i < 16; i += 1) {
        engine.tick();
        const inputPort = engine.ports.item(port) === CARGO ? 1 : 0;
        const onLane = engine.lanes.itemCountOf(lane);
        assert.equal(inputPort + onLane, 1, "exactly one item exists at all times");
        rests += inputPort;
    }
    assert.ok(rests >= 2, `the item laps (rested in the port ${rests} ticks)`);
});

// Deleting any ring cell opens the loop into one connected run of the rest.
test("deleting a ring cell opens the loop into one lane", async () => {
    const engine = await setup();
    buildRing3x3(engine);
    assert.equal(engine.lanes.ids().length, 1);

    deleteLane(engine, 2, 2);

    assert.equal(engine.lanes.ids().length, 1);
    assert.equal(engine.lanes.lengthOf(engine.lanes.ids()[0]), 7 * 2 - 1, "the seven survivors form one open run");
});

// A deletion that removes a cell's parent lets an older straight candidate take over.
test("deleting a junction parent merges the orphaned run into its straight candidate", async () => {
    const engine = await setup();
    placeLane(engine, 12, 3, Direction.RIGHT); // straight candidate from the west
    placeLane(engine, 13, 4, Direction.UP);    // junction parent from the south, newer, so it wins
    placeLane(engine, 13, 3, Direction.RIGHT);
    placeLane(engine, 14, 3, Direction.RIGHT);
    assert.equal(engine.lanes.ids().length, 2);

    deleteLane(engine, 13, 4);

    assert.equal(engine.lanes.ids().length, 1);
    assert.deepEqual(laneTiles(engine, laneAt(engine, 13, 3)), [[12, 3], [13, 3], [14, 3]]);
});

// A lane never spans a chunk border, so a cross-chunk parent stays a separate port-linked lane even
// after a deletion orphans its child.
test("a cross-chunk parent stays its own lane when a deletion orphans its child", async () => {
    const engine = await setup();
    placeLane(engine, 63, 3, Direction.RIGHT); // chunk 0
    placeLane(engine, 64, 4, Direction.UP);    // chunk 1
    placeLane(engine, 64, 3, Direction.RIGHT); // chunk 1
    placeLane(engine, 65, 3, Direction.RIGHT); // chunk 1

    deleteLane(engine, 64, 4);

    assert.equal(engine.lanes.ids().length, 2, "the cross-border parent does not fold in");
    for (const tile of [[63, 3], [64, 3], [65, 3]]) {
        assert.notEqual(laneAt(engine, tile[0], tile[1]), null, `${tile} still belongs to a lane`);
    }
});

// A cell whose output is buried is no surface candidate, even with a higher id: it cannot steal a
// surface junction.
test("a higher-id buried-output cell does not steal a surface junction", async () => {
    const engine = await setup();
    placeLane(engine, 0, 0, Direction.UP);
    placeLane(engine, 0, 1, Direction.UP);
    placeLane(engine, -1, 0, Direction.RIGHT); // the newest surface candidate into (0,0), so it wins
    const before = laneTiles(engine, laneAt(engine, 0, 0));

    placeLane(engine, 1, 0, Direction.LEFT, TestLaneDownType);

    assert.deepEqual(laneTiles(engine, laneAt(engine, 0, 0)), before, "the buried-output cell did not steal the junction");
});

// One cell per tile per layer: a second surface cell is refused, and a delete frees the tile.
test("a second surface cell cannot occupy the same tile, and delete frees it", async () => {
    const engine = await setup();
    assert.notEqual(placeLane(engine, 5, 5, Direction.UP), NO_EID, "first cell placed");
    assert.equal(placeLane(engine, 5, 5, Direction.RIGHT), NO_EID, "second surface cell on the tile is refused");

    deleteLane(engine, 5, 5);

    assert.notEqual(placeLane(engine, 5, 5, Direction.RIGHT), NO_EID, "the tile is free after the delete");
});

// Every cell is fed over one edge, chosen once at rebuild: a machine beside the head wins that
// cell's parent edge and hands it its input port, while a cell inside the lane is fed straight from the
// cell before it.
test("a head fed on its flank by a machine takes that edge as its parent edge and input port", async () => {
    const engine = await setup();
    engine.applyMessage(new CreateObjectMessage(TestMachineType.objectTypeId, 4, 5, Direction.RIGHT));
    placeLane(engine, 5, 5, Direction.UP);
    placeLane(engine, 5, 4, Direction.UP);

    const lane = laneAt(engine, 5, 5);
    const head = engine.placed.eidAt(5, 5, LAYER_SURFACE);
    const inside = engine.placed.eidAt(5, 4, LAYER_SURFACE);

    assert.equal(engine.lanes.parentEdgeOf(head), Direction.RIGHT, "the head is fed across its left flank");
    assert.equal(
        engine.lanes.inputPortOf(lane),
        engine.ports.at(5, 5, Direction.RIGHT),
        "and takes that edge as its input port",
    );
    assert.equal(engine.lanes.parentEdgeOf(inside), Direction.UP, "the cell inside the lane is fed straight");
});

// A machine dropped beside a finished lane moves that head's parent edge with it: the lane is derived
// from every adjacent object, not only from the cells placed before it.
test("a machine placed beside a finished lane head takes its flank as the input port", async () => {
    const engine = await setup();
    placeLane(engine, 5, 5, Direction.UP);
    placeLane(engine, 5, 4, Direction.UP);
    const head = engine.placed.eidAt(5, 5, LAYER_SURFACE);
    assert.equal(engine.lanes.parentEdgeOf(head), Direction.UP, "the head starts on its straight back edge");

    engine.applyMessage(new CreateObjectMessage(TestMachineType.objectTypeId, 4, 5, Direction.RIGHT));

    const lane = laneAt(engine, 5, 5);
    assert.equal(engine.lanes.parentEdgeOf(head), Direction.RIGHT, "the machine's edge became the parent edge");
    assert.equal(engine.lanes.inputPortOf(lane), engine.ports.at(5, 5, Direction.RIGHT), "and the lane's input port");

    engine.ports.setItem(engine.lanes.inputPortOf(lane), CARGO);
    let delivered = false;
    for (let i = 0; i < 12 && !delivered; i += 1) {
        engine.tick();
        delivered = engine.ports.item(engine.lanes.outputPortOf(lane)) === CARGO;
    }
    assert.ok(delivered, "the item waiting in the machine's output port rides the lane");
});

// Taking it away again puts the head back on its straight back edge.
test("deleting the machine returns the head to its back edge", async () => {
    const engine = await setup();
    placeLane(engine, 5, 5, Direction.UP);
    placeLane(engine, 5, 4, Direction.UP);
    engine.applyMessage(new CreateObjectMessage(TestMachineType.objectTypeId, 4, 5, Direction.RIGHT));
    const head = engine.placed.eidAt(5, 5, LAYER_SURFACE);
    const machine = engine.placed.eidAt(4, 5, LAYER_SURFACE);
    assert.equal(engine.lanes.parentEdgeOf(head), Direction.RIGHT, "the machine feeds the head's flank");

    engine.applyMessage(new DeleteObjectMessage(engine.placed.objectRefOf(machine)));

    assert.equal(engine.lanes.parentEdgeOf(head), Direction.UP, "the head is back on its back edge");
    assert.equal(engine.lanes.inputPortOf(laneAt(engine, 5, 5)), engine.ports.at(5, 5, Direction.UP));
});

// Re-laying a cell (delete then place, as the drag tool does at a corner) fires the port sweep. A
// flank turn earlier in the run must survive it: the run stays one lane, its bends intact, not
// split at the reset edge.
test("re-laying a far cell keeps an earlier flank turn linked", async () => {
    const engine = await setup();
    // Lay an L, re-laying each corner tile facing the new direction the way a drag does.
    placeLane(engine, 33, 35, Direction.UP);
    placeLane(engine, 33, 34, Direction.UP);
    deleteLane(engine, 33, 34);
    placeLane(engine, 33, 34, Direction.RIGHT);
    placeLane(engine, 34, 34, Direction.RIGHT);
    placeLane(engine, 35, 34, Direction.RIGHT);
    deleteLane(engine, 35, 34);
    placeLane(engine, 35, 34, Direction.UP);

    assert.equal(engine.lanes.ids().length, 1, "the whole L is one lane");
    assert.deepEqual(
        laneTiles(engine, laneAt(engine, 33, 35)),
        [[33, 35], [33, 34], [34, 34], [35, 34]],
    );
    assert.equal(engine.lanes.parentEdgeOf(engine.placed.eidAt(33, 34, LAYER_SURFACE)), Direction.LEFT,
        "the first corner is still fed across its flank");
});
