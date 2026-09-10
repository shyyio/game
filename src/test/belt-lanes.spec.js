import {EMPTY} from "@/sim/AbstractComponent.js";
import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction, LAYER_SURFACE} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {NO_LANE} from "@/sim/LaneIndex.js";
import {BeltType} from "@/mods/logistics/common/objectTypes.js";
import {makeGameEngine} from "@/test/ecsSim.js";

const RED = 1;
const CELLS = [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}];
const HEAD = {x: 0, y: 2};
const EXPECTED = [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, RED, RED, EMPTY, EMPTY, EMPTY];

async function lineOfBelts() {
    const engine = await makeGameEngine();
    for (const cell of CELLS) {
        engine.applyMessage(new CreateObjectMessage(BeltType.objectTypeId, cell.x, cell.y, Direction.UP));
    }
    return engine;
}

// A belt is a lane cell: the core derives the run from the placed belts.
test("a belt line is one lane", async () => {
    const engine = await lineOfBelts();
    const lane = engine.lanes.getLaneRefAt(HEAD.x, HEAD.y, LAYER_SURFACE);
    assert.notEqual(lane, NO_LANE, "the head belt is on a lane");
    assert.equal(engine.lanes.getCellEidsByLaneRef(lane).length, CELLS.length);
    assert.equal(engine.lanes.getLaneRefs().length, 1);
});

test("a belt line placed via messages flows two items to the tail", async () => {
    const engine = await lineOfBelts();
    const lane = engine.lanes.getLaneRefAt(HEAD.x, HEAD.y, LAYER_SURFACE);
    const stream = [];
    for (let i = 0; i < 10; i += 1) {
        engine.ports.setItem(engine.lanes.getOutputPortEidByLaneRef(lane), EMPTY);
        if (i < 2) {
            engine.ports.setItem(engine.lanes.getInputPortEidByLaneRef(lane), RED);
        }
        engine.tick();
        stream.push(engine.ports.getItemByPortEid(engine.lanes.getOutputPortEidByLaneRef(lane)));
    }
    assert.deepEqual(stream, EXPECTED);
});

test("deleting a belt takes its tile off the lane", async () => {
    const engine = await lineOfBelts();
    const eid = engine.placed.getEidAt(0, 1, LAYER_SURFACE);
    engine.applyMessage(new DeleteObjectMessage(engine.placed.getObjectRefByEid(eid)));
    assert.equal(engine.lanes.getLaneRefAt(0, 1, LAYER_SURFACE), NO_LANE);
    assert.equal(engine.lanes.getLaneRefs().length, 2, "the survivors are two lanes");
});
