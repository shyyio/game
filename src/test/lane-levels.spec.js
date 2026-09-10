import {EMPTY, NO_EID} from "@/sim/AbstractComponent.js";
import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction, CHUNK_SIZE, LAYER_SURFACE} from "@/common/constants.js";
import {getLaneLevelLayer, LANE_LEVEL_BURIED, LANE_LEVEL_ELEVATED_1} from "@/sim/LaneIndex.js";
import {ModPackage} from "@/common/ModPackage.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {
    LaneFixtureDeclaration,
    TestLaneDownType,
    TestLaneBuriedType,
    TestLaneUpType,
    TestLaneRampUpType,
    TestLaneElevatedType,
    TestLaneRampDownType,
    ITEM_TYPE_TEST_CARGO,
    placeLane,
    deleteLane,
    getLaneRefAt,
    laneTiles,
    itemCells,
} from "@/test/laneFixture.js";

const CARGO = ITEM_TYPE_TEST_CARGO;

async function setup() {
    return makeGameEngine([new ModPackage(new LaneFixtureDeclaration())]);
}

// The buried level is axis-split, so a horizontal run has its own layer.
function buriedLaneAt(engine, tileX, tileY) {
    return getLaneRefAt(engine, tileX, tileY, getLaneLevelLayer(LANE_LEVEL_BURIED, Direction.RIGHT));
}

// The elevated level is not split: one layer whatever the direction.
function elevatedLaneAt(engine, tileX, tileY) {
    return getLaneRefAt(engine, tileX, tileY, getLaneLevelLayer(LANE_LEVEL_ELEVATED_1, Direction.RIGHT));
}

// A down mouth, buried cells and an up mouth link into one lane: the layers match end to end.
test("a down mouth, buried cells and an up mouth are one lane", async () => {
    const engine = await setup();
    placeLane(engine, 1, 1, Direction.RIGHT, TestLaneDownType);
    placeLane(engine, 2, 1, Direction.RIGHT, TestLaneBuriedType);
    placeLane(engine, 3, 1, Direction.RIGHT, TestLaneBuriedType);
    placeLane(engine, 4, 1, Direction.RIGHT, TestLaneUpType);

    const lane = getLaneRefAt(engine, 1, 1);
    assert.deepEqual(laneTiles(engine, lane), [[1, 1], [2, 1], [3, 1], [4, 1]]);
    assert.equal(engine.lanes.getLaneRefs().length, 1);
});

// Adjacent mouths need nothing between them.
test("adjacent mouths link with no buried cell between", async () => {
    const engine = await setup();
    placeLane(engine, 1, 1, Direction.RIGHT, TestLaneDownType);
    placeLane(engine, 2, 1, Direction.RIGHT, TestLaneUpType);

    assert.deepEqual(laneTiles(engine, getLaneRefAt(engine, 1, 1)), [[1, 1], [2, 1]]);
});

// A down mouth's output is buried, so it never links to a surface cell ahead of it.
test("a down mouth does not link to the surface cell ahead", async () => {
    const engine = await setup();
    placeLane(engine, 1, 1, Direction.RIGHT, TestLaneDownType);
    placeLane(engine, 2, 1, Direction.RIGHT);

    assert.equal(engine.lanes.getLaneRefs().length, 2, "the buried output and the surface cell are separate lanes");
});

// A buried cell occupies its axis layer, so a surface lane stands on the same tile untouched, and
// neither carries the other's items.
test("a buried lane passes under a surface lane on the same tile", async () => {
    const engine = await setup();
    placeLane(engine, 5, 5, Direction.UP);
    placeLane(engine, 5, 4, Direction.UP);
    placeLane(engine, 4, 5, Direction.RIGHT, TestLaneDownType);
    placeLane(engine, 5, 5, Direction.RIGHT, TestLaneBuriedType);
    placeLane(engine, 6, 5, Direction.RIGHT, TestLaneUpType);

    const surface = getLaneRefAt(engine, 5, 5, LAYER_SURFACE);
    const buried = buriedLaneAt(engine, 5, 5);
    assert.notEqual(surface, buried, "both lanes stand on the tile");

    engine.ports.setItem(engine.lanes.getInputPortEidByLaneRef(buried), CARGO);
    let delivered = 0;
    for (let i = 0; i < 12; i += 1) {
        engine.tick();
        if (engine.ports.getItemByPortEid(engine.lanes.getOutputPortEidByLaneRef(buried)) === CARGO) {
            delivered += 1;
            engine.ports.setItem(engine.lanes.getOutputPortEidByLaneRef(buried), EMPTY);
        }
    }

    assert.equal(delivered, 1, "the buried lane delivered its item once");
    assert.equal(engine.lanes.getItemCountByLaneRef(surface), 0, "the surface lane never copied it");
});

// A buried lane crossing a chunk seam takes that edge as its own input port; a surface lane head whose
// flank is the same edge must leave it alone, or the one item would be ingested twice.
test("a buried lane crossing a seam keeps its own input port", async () => {
    const engine = await setup();
    const seam = CHUNK_SIZE;
    // A surface lane flowing UP off the seam tile, placed first, so its flank is that tile's RIGHT edge.
    placeLane(engine, seam, 4, Direction.UP);
    placeLane(engine, seam, 5, Direction.UP);
    // A buried run crossing the seam on the same tiles.
    placeLane(engine, seam - 2, 5, Direction.RIGHT, TestLaneDownType);
    placeLane(engine, seam - 1, 5, Direction.RIGHT, TestLaneBuriedType);
    placeLane(engine, seam, 5, Direction.RIGHT, TestLaneBuriedType);
    placeLane(engine, seam + 1, 5, Direction.RIGHT, TestLaneUpType);

    const buried = buriedLaneAt(engine, seam, 5);
    const surface = getLaneRefAt(engine, seam, 5, LAYER_SURFACE);
    assert.equal(
        engine.lanes.getInputPortEidByLaneRef(buried),
        engine.ports.getPortEidAt(seam, 5, Direction.RIGHT),
        "the seam edge is the buried lane's input port",
    );

    engine.ports.setItem(engine.lanes.getInputPortEidByLaneRef(buried), CARGO);
    let delivered = 0;
    let stolen = 0;
    for (let i = 0; i < 12; i += 1) {
        engine.tick();
        if (engine.ports.getItemByPortEid(engine.lanes.getOutputPortEidByLaneRef(buried)) === CARGO) {
            delivered += 1;
            engine.ports.setItem(engine.lanes.getOutputPortEidByLaneRef(buried), EMPTY);
        }
        if (engine.ports.getItemByPortEid(engine.lanes.getOutputPortEidByLaneRef(surface)) === CARGO) {
            stolen += 1;
            engine.ports.setItem(engine.lanes.getOutputPortEidByLaneRef(surface), EMPTY);
        }
    }

    assert.equal(stolen, 0, "the surface lane never took the buried item");
    assert.equal(engine.lanes.getItemCountByLaneRef(surface), 0, "and carries nothing");
    assert.equal(delivered, 1, "the buried lane delivered it once");
});

// Deleting a buried cell splits the run; an item standing upstream of the cut is kept.
test("deleting a buried cell keeps the item on the surviving upstream piece", async () => {
    const engine = await setup();
    placeLane(engine, 1, 1, Direction.RIGHT, TestLaneDownType);
    placeLane(engine, 2, 1, Direction.RIGHT, TestLaneBuriedType);
    placeLane(engine, 3, 1, Direction.RIGHT, TestLaneBuriedType);
    placeLane(engine, 4, 1, Direction.RIGHT, TestLaneUpType);
    const lane = getLaneRefAt(engine, 1, 1);
    engine.ports.setItem(engine.lanes.getInputPortEidByLaneRef(lane), CARGO);
    engine.tick();
    assert.equal(itemCells(engine), 1, "the item is in the buried run");

    deleteLane(engine, 3, 1, getLaneLevelLayer(LANE_LEVEL_BURIED, Direction.RIGHT));

    assert.equal(itemCells(engine), 1, "the item is kept on the piece it stands on");
    assert.equal(engine.lanes.getLaneRefs().length, 2, "the run is cut in two");
});

// A ramp up, an elevated run and a ramp down are one lane, exactly as the buried kinds are: a ramp
// is only a cell whose two levels differ.
test("a ramp up, an elevated run and a ramp down are one lane", async () => {
    const engine = await setup();
    placeLane(engine, 1, 1, Direction.RIGHT, TestLaneRampUpType);
    placeLane(engine, 2, 1, Direction.RIGHT, TestLaneElevatedType);
    placeLane(engine, 3, 1, Direction.RIGHT, TestLaneElevatedType);
    placeLane(engine, 4, 1, Direction.RIGHT, TestLaneRampDownType);

    assert.deepEqual(laneTiles(engine, getLaneRefAt(engine, 1, 1)), [[1, 1], [2, 1], [3, 1], [4, 1]]);
    assert.equal(engine.lanes.getLaneRefs().length, 1);
});

// The elevated level is not axis-split, so an elevated run turns a corner the way a surface one does.
test("an elevated run bends", async () => {
    const engine = await setup();
    placeLane(engine, 1, 1, Direction.RIGHT, TestLaneRampUpType);
    placeLane(engine, 2, 1, Direction.RIGHT, TestLaneElevatedType);
    placeLane(engine, 3, 1, Direction.UP, TestLaneElevatedType);
    placeLane(engine, 3, 0, Direction.UP, TestLaneRampDownType);

    assert.deepEqual(laneTiles(engine, getLaneRefAt(engine, 1, 1)), [[1, 1], [2, 1], [3, 1], [3, 0]]);
});

// An elevated lane stands over a surface lane on the same tile, and neither carries the other's items.
test("an elevated lane passes over a surface lane on the same tile", async () => {
    const engine = await setup();
    placeLane(engine, 5, 5, Direction.UP);
    placeLane(engine, 5, 4, Direction.UP);
    placeLane(engine, 4, 5, Direction.RIGHT, TestLaneRampUpType);
    placeLane(engine, 5, 5, Direction.RIGHT, TestLaneElevatedType);
    placeLane(engine, 6, 5, Direction.RIGHT, TestLaneRampDownType);

    const surface = getLaneRefAt(engine, 5, 5, LAYER_SURFACE);
    const elevated = elevatedLaneAt(engine, 5, 5);
    assert.notEqual(surface, elevated, "both lanes stand on the tile");

    engine.ports.setItem(engine.lanes.getInputPortEidByLaneRef(elevated), CARGO);
    let delivered = 0;
    for (let i = 0; i < 12; i += 1) {
        engine.tick();
        if (engine.ports.getItemByPortEid(engine.lanes.getOutputPortEidByLaneRef(elevated)) === CARGO) {
            delivered += 1;
            engine.ports.setItem(engine.lanes.getOutputPortEidByLaneRef(elevated), EMPTY);
        }
    }

    assert.equal(delivered, 1, "the elevated lane delivered its item once");
    assert.equal(engine.lanes.getItemCountByLaneRef(surface), 0, "the surface lane never took it");
});

// An elevated cell's output is off the surface, so it never links to a surface cell ahead: flow
// reaches the surface only through a ramp.
test("an elevated cell does not link to the surface cell ahead", async () => {
    const engine = await setup();
    placeLane(engine, 1, 1, Direction.RIGHT, TestLaneRampUpType);
    placeLane(engine, 2, 1, Direction.RIGHT, TestLaneElevatedType);
    placeLane(engine, 3, 1, Direction.RIGHT);

    assert.equal(engine.lanes.getLaneRefs().length, 2, "the elevated run and the surface cell are separate lanes");
});

// One layer per unsplit level, so two elevated cells cannot share a tile; crossing needs a level of
// its own.
test("two elevated cells cannot occupy the same tile", async () => {
    const engine = await setup();
    assert.notEqual(placeLane(engine, 7, 7, Direction.RIGHT, TestLaneElevatedType), NO_EID, "the first is placed");
    assert.equal(placeLane(engine, 7, 7, Direction.UP, TestLaneElevatedType), NO_EID, "the second is refused");
});

// Two buried runs crossing at right angles do share a tile: the buried level is axis-split.
test("two buried runs cross on one tile", async () => {
    const engine = await setup();
    placeLane(engine, 7, 7, Direction.RIGHT, TestLaneBuriedType);
    placeLane(engine, 7, 7, Direction.UP, TestLaneBuriedType);

    assert.notEqual(
        getLaneRefAt(engine, 7, 7, getLaneLevelLayer(LANE_LEVEL_BURIED, Direction.RIGHT)),
        getLaneRefAt(engine, 7, 7, getLaneLevelLayer(LANE_LEVEL_BURIED, Direction.UP)),
        "the two axes are separate lanes on one tile",
    );
});
