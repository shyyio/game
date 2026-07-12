import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {BELT_NORMAL} from "@/mods/Logistics/constants.js";
import {CreateBeltMessage} from "@/mods/Logistics/messages.js";
import {EMPTY} from "@/common/sim/EcsEngine.js";
import {EcsSimEngine} from "@/common/sim/EcsSimEngine.js";
import {makeEcsSimEngine} from "@/test/ecsSim.js";
import {SqlEngine} from "@/test/SqlEngine.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";

const RED = 1;
const CELLS = [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}];
const HEAD = {x: 0, y: 2};

// Drive the bitECS SimEngine end-to-end through player messages: place a belt line, feed an item,
// tick, read the output stream.
async function ecsRun() {
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
    return stream;
}

async function sqlRun() {
    const engine = new SqlEngine([new LogisticsMod()]);
    await engine.init();
    CELLS.forEach(cell => engine.dispatchMessage(new CreateBeltMessage(cell.x, cell.y, Direction.UP, BELT_NORMAL)));
    const inPort = Number(engine.rawScalar("SELECT in_port_id FROM BeltPath"));
    const outPort = Number(engine.rawScalar("SELECT out_port_id FROM BeltPath"));
    const stream = [];
    for (let i = 0; i < 10; i += 1) {
        engine.setPortItem(outPort, EMPTY);
        if (i < 2) {
            engine.setPortItem(inPort, RED);
        }
        engine.tickAll();
        const item = engine.portItem(outPort);
        stream.push(item === null || item === undefined ? EMPTY : item);
    }
    return stream;
}

test("a belt line placed and ticked via messages on EcsSimEngine flows like SQL", async () => {
    assert.deepEqual(await ecsRun(), await sqlRun());
});
