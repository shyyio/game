import {EMPTY, NO_EID} from "@/sim/AbstractComponent.js";
import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {getLaneLevelLayer, LANE_LEVEL_ELEVATED_1} from "@/sim/LaneIndex.js";
import {
    BeltRampUp1Type,
    BeltElevated1Type,
    BeltRampDown1Type,
} from "@/mods/logistics/common/objectTypes.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {placeBelt, beltLaneAt} from "@/test/beltFixture.js";

const RED = 1;

test("an item rides a ramp-up / elevated / ramp-down run as one lane", async () => {
    const engine = await makeGameEngine();

    placeBelt(engine, 0, 5, Direction.UP);
    placeBelt(engine, 0, 4, Direction.UP, BeltRampUp1Type);
    placeBelt(engine, 0, 3, Direction.UP, BeltElevated1Type);
    placeBelt(engine, 0, 2, Direction.UP, BeltElevated1Type);
    placeBelt(engine, 0, 1, Direction.UP, BeltRampDown1Type);

    const elevated = getLaneLevelLayer(LANE_LEVEL_ELEVATED_1, Direction.UP);
    const lane = beltLaneAt(engine, 0, 5);
    assert.equal(beltLaneAt(engine, 0, 4).laneRef, lane.laneRef);
    assert.equal(beltLaneAt(engine, 0, 3, elevated).laneRef, lane.laneRef);
    assert.equal(beltLaneAt(engine, 0, 1).laneRef, lane.laneRef, "the whole run is one lane");

    engine.ports.setItem(lane.inputPort, RED);
    let arrived = false;
    for (let i = 0; i < 20 && !arrived; i += 1) {
        engine.ports.setItem(lane.outputPort, EMPTY);
        engine.tick();
        arrived = engine.ports.getItemByPortEid(lane.outputPort) === RED;
    }
    assert.ok(arrived, "the item rode over the elevated run to the output");
});

test("an elevated belt linked to nothing is refused", async () => {
    const engine = await makeGameEngine();

    placeBelt(engine, 0, 3, Direction.UP, BeltElevated1Type);

    const elevated = getLaneLevelLayer(LANE_LEVEL_ELEVATED_1, Direction.UP);
    assert.equal(engine.placed.getEidAt(0, 3, elevated), NO_EID, "nothing stands there");
});

test("an elevated belt lands behind the elevated cell it would parent", async () => {
    const engine = await makeGameEngine();

    placeBelt(engine, 0, 4, Direction.UP, BeltRampUp1Type);
    placeBelt(engine, 0, 3, Direction.UP, BeltElevated1Type);
    // Parented by nothing, but its output meets the run above it.
    placeBelt(engine, 1, 3, Direction.LEFT, BeltElevated1Type);

    const elevated = getLaneLevelLayer(LANE_LEVEL_ELEVATED_1, Direction.UP);
    assert.notEqual(engine.placed.getEidAt(1, 3, elevated), NO_EID, "the joining cell stands");
});

test("a ramp down alone takes no elevated cell behind it that misses its input", async () => {
    const engine = await makeGameEngine();

    placeBelt(engine, 0, 3, Direction.UP, BeltRampDown1Type);
    // A ramp down takes only its straight input, so a cell coming at its flank joins nothing.
    placeBelt(engine, 1, 4, Direction.LEFT, BeltElevated1Type);

    const elevated = getLaneLevelLayer(LANE_LEVEL_ELEVATED_1, Direction.UP);
    assert.equal(engine.placed.getEidAt(1, 4, elevated), NO_EID, "nothing stands there");
});
