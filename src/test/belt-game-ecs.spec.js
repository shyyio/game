import {test} from "node:test";
import assert from "node:assert/strict";
import {ModRegistry} from "@/common/ModRegistry.js";
import {Game} from "@/common/Game.js";
import {Direction} from "@/common/constants.js";
import {BELT_NORMAL} from "@/mods/Logistics/constants.js";
import {CreateBeltMessage} from "@/mods/Logistics/messages.js";
import {EMPTY} from "@/common/sim/EcsEngine.js";
import {EcsSimEngine} from "@/common/sim/EcsSimEngine.js";
import {TICK_PHASE_ORDER} from "@/common/sim/EcsEngine.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";

const RED = 1;
const CELLS = [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}];
const HEAD = {x: 0, y: 2};
const EXPECTED = [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, RED, RED, EMPTY, EMPTY, EMPTY];

// Drive a real Game built on the bitECS engine: dispatch belt-placement messages, tick, read output.
test("a Game on EcsSimEngine places and ticks belts via messages", async () => {
    const modRegistry = new ModRegistry();
    modRegistry.loadMod(new LogisticsMod());
    const engine = new EcsSimEngine(modRegistry);
    const game = new Game(modRegistry, engine);
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
    assert.deepEqual(stream, EXPECTED);
});
