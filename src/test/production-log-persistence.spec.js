import {test} from "node:test";
import assert from "node:assert/strict";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {makeGame} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {ProductionLogRequestMessage} from "@/mods/ProductionLog/common/messages.js";
import {ProductionLogEvent} from "@/mods/ProductionLog/common/events.js";

const IRON = 321;

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
