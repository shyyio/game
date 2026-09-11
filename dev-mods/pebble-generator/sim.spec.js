// Runs the real game headless: build the machine, let ticks pass, read what came out. Nothing drawn
// on screen (client.js) is tested here.

import {test} from "node:test";
import assert from "node:assert/strict";
import {makeGameEngine, makeGame} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {CreateObjectMessage, ClaimChunkMessage, Direction, chunkKeyAt} from "@spup/sdk";
import {PebbleGeneratorType} from "./common/objectTypes.js";
import {ITEM_TYPE_PEBBLE, GENERATOR_TICKS} from "./common/constants.js";
import {GeneratorCountRequestMessage} from "./common/messages.js";
import {GeneratorCountEvent} from "./common/events.js";

// One production cycle, plus slack for starting and delivering.
const TICK_BUDGET = GENERATOR_TICKS + 4;

/**
 * @param {GameEngine} engine
 * @returns {number} the output port of the one placed generator
 */
function outputPortOf(engine) {
    const [eid] = engine.placed.getEidsByTypeId(PebbleGeneratorType.objectTypeId);
    const generators = engine.components.getComponentByName("Generator");
    return generators.store.outputPort[generators.getRowByEid(eid)];
}

/**
 * @param {CapturingSession} session
 * @returns {number[]} the counts it was told, in order
 */
function countsSeen(session) {
    return session.events.filter(event => event instanceof GeneratorCountEvent).map(event => event.count);
}

test("a generator fills its output port with a pebble, no sooner than configured", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(PebbleGeneratorType.objectTypeId, 5, 5, Direction.UP));
    const outputPort = outputPortOf(engine);

    let ticks = 0;
    while (engine.ports.getItemByPortEid(outputPort) !== ITEM_TYPE_PEBBLE && ticks < TICK_BUDGET) {
        engine.tick();
        ticks += 1;
    }

    assert.equal(engine.ports.getItemByPortEid(outputPort), ITEM_TYPE_PEBBLE);
    assert.ok(ticks >= GENERATOR_TICKS, `took ${ticks} ticks, at least ${GENERATOR_TICKS} expected`);
});

test("a session that asks for the count is told it, then told again when it changes", async () => {
    const game = await makeGame();
    const builder = new CapturingSession(1);
    game.connect(builder);
    game.dispatchMessage(new ClaimChunkMessage(chunkKeyAt(5, 5)), builder);

    game.dispatchMessage(new GeneratorCountRequestMessage(), builder);
    game.dispatchMessage(new CreateObjectMessage(PebbleGeneratorType.objectTypeId, 5, 5, Direction.UP), builder);
    game.runTick();
    game.runTick();

    assert.deepEqual(countsSeen(builder), [0, 1]);
});

test("a session that never asked is told nothing", async () => {
    const game = await makeGame();
    const builder = new CapturingSession(1);
    game.connect(builder);
    game.dispatchMessage(new ClaimChunkMessage(chunkKeyAt(5, 5)), builder);

    game.dispatchMessage(new CreateObjectMessage(PebbleGeneratorType.objectTypeId, 5, 5, Direction.UP), builder);
    game.runTick();

    assert.deepEqual(countsSeen(builder), []);
});
