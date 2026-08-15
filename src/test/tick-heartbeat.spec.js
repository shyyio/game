import {test} from "node:test";
import assert from "node:assert/strict";
import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {TickEndEvent} from "@/common/CoreEvents.js";
import {ecsModRegistry} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";

async function setup() {
    const modRegistry = ecsModRegistry();
    const game = new Game(modRegistry, new GameEngine(modRegistry));
    await game.init();
    return game;
}

function heartbeats(session) {
    return session.events.filter(event => event instanceof TickEndEvent);
}

test("every session gets one tick heartbeat per tick, subscribed to nothing", async () => {
    const game = await setup();
    const session = new CapturingSession(1);
    game.connect(session);

    game.runTick();
    game.runTick();

    assert.deepEqual(heartbeats(session).map(event => event.clock), [1, 2]);
});

test("a session that joins mid-world hears the clock it joined at", async () => {
    const game = await setup();
    game.runTick();
    game.runTick();
    const latecomer = new CapturingSession(2);
    game.connect(latecomer);

    game.runTick();

    assert.deepEqual(heartbeats(latecomer).map(event => event.clock), [3]);
});

test("a disconnected session stops hearing the clock", async () => {
    const game = await setup();
    const session = new CapturingSession(1);
    game.connect(session);

    game.runTick();
    game.disconnect(session.id);
    game.runTick();

    assert.equal(heartbeats(session).length, 1);
});
