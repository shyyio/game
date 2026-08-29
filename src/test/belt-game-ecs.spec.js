import {test} from "node:test";
import assert from "node:assert/strict";
import {Game} from "@/sim/Game.js";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {BeltDefinition} from "@/mods/Logistics/common/objectTypes.js";
import {GameEngine, TICK_PHASE_ORDER} from "@/sim/GameEngine.js";
import {EMPTY} from "@/sim/sentinels.js";
import {ecsModRegistry} from "@/test/ecsSim.js";
import {beltsOf} from "@/mods/Logistics/sim/testHelpers.js";
import {CapturingSession} from "@/test/CapturingSession.js";

const RED = 1;
const CELLS = [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}];
const HEAD = {x: 0, y: 2};
const EXPECTED = [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, RED, RED, EMPTY, EMPTY, EMPTY];

// Drive a real Game built on the ECS engine: dispatch belt-placement messages, tick, read output.
test("a Game on GameEngine places and ticks belts via messages", async () => {
    const modRegistry = ecsModRegistry();
    const engine = new GameEngine(modRegistry);
    const game = new Game(modRegistry, engine);
    await game.init();

    const session = new CapturingSession();
    for (const cell of CELLS) {
        game.dispatchMessage(new CreateObjectMessage(BeltDefinition.typeId, cell.x, cell.y, Direction.UP), session);
    }

    const path = beltsOf(engine).pathAt(HEAD.x, HEAD.y);
    const stream = [];
    for (let i = 0; i < 10; i += 1) {
        engine.setPortItem(path.outPort, EMPTY);
        if (i < 2) {
            engine.setPortItem(path.inPort, RED);
        }
        for (const phase of TICK_PHASE_ORDER) {
            game.tick(phase);
        }
        stream.push(engine.portItem(path.outPort));
    }
    assert.deepEqual(stream, EXPECTED);
});
