import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {BELT_NORMAL} from "@/mods/Logistics/constants.js";
import {CreateBeltMessage} from "@/mods/Logistics/messages.js";
import {EMPTY} from "@/common/sim/EcsEngine.js";
import {makeEcsSimEngine} from "@/test/ecsSim.js";

const RED = 1;
const CELLS = [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}];
const HEAD = {x: 0, y: 2};

// Drive the bitECS SimEngine end-to-end through player messages: place a belt line, feed two items,
// tick, read the output stream. Two RED items enter and both exit at the tail out-port.
const EXPECTED = [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, RED, RED, EMPTY, EMPTY, EMPTY];

test("a belt line placed and ticked via messages on EcsSimEngine flows two items to the tail", async () => {
    const engine = await makeEcsSimEngine();
    CELLS.forEach(cell => engine.applyMessage(new CreateBeltMessage(cell.x, cell.y, Direction.UP, BELT_NORMAL)));
    const path = engine.belts.pathAt(HEAD.x, HEAD.y);
    const stream = [];
    for (let i = 0; i < 10; i += 1) {
        engine.engine.setPortItem(path.outPort, EMPTY);
        if (i < 2) {
            engine.engine.setPortItem(path.inPort, RED);
        }
        engine.tickAll();
        stream.push(engine.engine.portItem(path.outPort));
    }
    assert.deepEqual(stream, EXPECTED);
});
