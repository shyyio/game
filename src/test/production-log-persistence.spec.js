import {test} from "node:test";
import assert from "node:assert/strict";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {makeGame} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {ProductionLogRequestMessage} from "@/mods/production-log/common/messages.js";
import {ProductionLogEvent} from "@/mods/production-log/common/events.js";

const IRON = 321;
// No mod declares this one, as a loadout change leaves an item type behind.
const UNDECLARED = 99_999;

test("production counts survive a save/load", async () => {
    const store = new NodeSaveStore(":memory:");
    const game = await makeGame([], store);
    const alice = game.players.getOrCreate("sub-alice", "alice");
    game.simEngine.itemProduced.notify(alice.playerId, IRON, 5);
    await game.save();

    const restored = await makeGame([], store);
    assert.equal(await restored.load(), true);
    const session = new CapturingSession(alice.playerId);
    restored.connect(session);
    restored.dispatchMessage(new ProductionLogRequestMessage(alice.playerId), session);
    const logs = session.events.filter(event => event instanceof ProductionLogEvent);
    assert.deepEqual(logs[0].itemTypes, [IRON]);
    assert.deepEqual(logs[0].counts, [5]);
});

test("a count for an item type no mod declares any more does not come back", async () => {
    const store = new NodeSaveStore(":memory:");
    const game = await makeGame([], store);
    const alice = game.players.getOrCreate("sub-alice", "alice");
    game.simEngine.itemProduced.notify(alice.playerId, UNDECLARED, 5);
    const declared = Array.from(game.modRegistry.items.entries())[0][0];
    game.simEngine.itemProduced.notify(alice.playerId, declared, 2);
    await game.save();

    const restored = await makeGame([], store);
    assert.equal(await restored.load(), true);
    const session = new CapturingSession(alice.playerId);
    restored.connect(session);
    restored.dispatchMessage(new ProductionLogRequestMessage(alice.playerId), session);
    const log = session.events.filter(event => event instanceof ProductionLogEvent)[0];
    assert.deepEqual([log.itemTypes, log.counts], [[declared], [2]]);
});
