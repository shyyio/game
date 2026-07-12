import {test} from "node:test";
import assert from "node:assert/strict";
import {ModRegistry} from "@/common/ModRegistry.js";
import {DatabaseSchema} from "@/common/DatabaseSchema.js";
import {NodeDatabase} from "@/server/NodeDatabase.js";
import {Game} from "@/common/Game.js";
import {Direction} from "@/common/constants.js";
import {BELT_NORMAL} from "@/mods/Logistics/constants.js";
import {CreateBeltMessage} from "@/mods/Logistics/messages.js";
import {EMPTY} from "@/common/sim/EcsEngine.js";
import {EcsSimEngine} from "@/common/sim/EcsSimEngine.js";
import {TICK_PHASE_ORDER} from "@/common/sim/SimEngine.js";
import {SqlEngine} from "@/test/SqlEngine.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";

const RED = 1;
const CELLS = [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}];
const HEAD = {x: 0, y: 2};

// Drive a real Game built on the bitECS engine: dispatch belt-placement messages, tick, read output.
async function ecsGameRun() {
    const modRegistry = new ModRegistry();
    modRegistry.loadMod(new LogisticsMod());
    const schema = new DatabaseSchema(modRegistry);
    const db = new NodeDatabase(schema);
    const engine = new EcsSimEngine(modRegistry);
    const game = new Game(modRegistry, db, engine);
    await game.init();

    CELLS.forEach(cell => game.dispatchMessage(new CreateBeltMessage(cell.x, cell.y, Direction.UP, BELT_NORMAL), null));

    const path = engine.belts.pathAt(HEAD.x, HEAD.y);
    const stream = [];
    for (let i = 0; i < 10; i += 1) {
        engine.engine.setPortItem(path.outPort, EMPTY);
        if (i < 2) {
            engine.engine.setPortItem(path.inPort, RED);
        }
        TICK_PHASE_ORDER.forEach(phase => game.tick(phase));
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

test("a Game on EcsSimEngine places and ticks belts via messages, matching SQL", async () => {
    assert.deepEqual(await ecsGameRun(), await sqlRun());
});
