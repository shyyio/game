import {test} from "node:test";
import assert from "node:assert/strict";
import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {chunkId} from "@/common/util.js";
import {ClaimChunkMessage} from "@/common/ClaimMessages.js";
import {AddFriendMessage} from "@/common/PlayerMessages.js";
import {ecsModRegistry} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";

async function makeGame(saveStore) {
    const modRegistry = ecsModRegistry();
    const game = new Game(modRegistry, new GameEngine(modRegistry), saveStore);
    await game.init();
    return game;
}

test("players, friends, and claims survive a save/load", async () => {
    const store = new NodeSaveStore(":memory:");
    const game = await makeGame(store);
    const alice = game.players.getOrCreate("alice");
    const bob = game.players.getOrCreate("bob");
    bob.maxChunks = 20;
    const aliceSession = new CapturingSession(alice.playerId);
    game.connect(aliceSession);
    game.dispatchMessage(new ClaimChunkMessage(chunkId(0, 0)), aliceSession);
    game.dispatchMessage(new ClaimChunkMessage(chunkId(64, 0)), aliceSession);
    game.dispatchMessage(new AddFriendMessage("bob"), aliceSession);
    await game.save();

    const restored = await makeGame(store);
    assert.equal(await restored.load(), true);
    assert.equal(restored.players.byId(alice.playerId).username, "alice");
    assert.equal(restored.players.byId(bob.playerId).maxChunks, 20);
    assert.equal(restored.players.isFriend(alice.playerId, bob.playerId), true);
    assert.equal(restored.claims.ownerOf(chunkId(0, 0)), alice.playerId);
    assert.equal(restored.claims.ownerOf(chunkId(64, 0)), alice.playerId);
    assert.equal(restored.claims.countOf(alice.playerId), 2);
    // The id counter resumes past the loaded players.
    assert.equal(restored.players.getOrCreate("carol").playerId, 3);
});

test("a snapshot without tables loads with empty registries", async () => {
    const store = new NodeSaveStore(":memory:");
    const seed = await makeGame(store);
    // A pre-tables save: the raw engine snapshot, no tables section.
    await store.save(seed.simEngine.serialize());

    const restored = await makeGame(store);
    assert.equal(await restored.load(), true);
    assert.equal(restored.players.has(1), false);
    assert.equal(restored.claims.countOf(1), 0);
});
