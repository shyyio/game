import {test} from "node:test";
import assert from "node:assert/strict";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {chunkKeyAt} from "@/common/util.js";
import {ClaimChunkMessage} from "@/common/ClaimMessages.js";
import {AddFriendMessage} from "@/common/PlayerMessages.js";
import {makeGame} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";

test("players, friends, and claims survive a save/load", async () => {
    const store = new NodeSaveStore(":memory:");
    const game = await makeGame([], store);
    const alice = game.players.getOrCreate("sub-alice", "alice");
    const bob = game.players.getOrCreate("sub-bob", "bob");
    bob.maxChunks = 20;
    const aliceSession = new CapturingSession(alice.playerRef);
    game.connect(aliceSession);
    game.dispatchMessage(new ClaimChunkMessage(chunkKeyAt(0, 0)), aliceSession);
    game.dispatchMessage(new ClaimChunkMessage(chunkKeyAt(64, 0)), aliceSession);
    game.dispatchMessage(new AddFriendMessage(bob.playerRef), aliceSession);
    await game.save();

    const restored = await makeGame([], store);
    assert.equal(await restored.load(), true);
    assert.equal(restored.players.getPlayerByRef(alice.playerRef).username, "alice");
    assert.equal(restored.players.getPlayerByRef(bob.playerRef).maxChunks, 20);
    assert.equal(restored.players.isFriend(alice.playerRef, bob.playerRef), true);
    assert.equal(restored.claims.getOwnerByChunkKey(chunkKeyAt(0, 0)), alice.playerRef);
    assert.equal(restored.claims.getOwnerByChunkKey(chunkKeyAt(64, 0)), alice.playerRef);
    assert.equal(restored.claims.getCountByPlayerRef(alice.playerRef), 2);
    // The id counter resumes past the loaded players.
    assert.equal(restored.players.getOrCreate("sub-carol", "carol").playerRef, 3);
});

test("player settings survive a save/load", async () => {
    const store = new NodeSaveStore(":memory:");
    const game = await makeGame([], store);
    const alice = game.players.getOrCreate("sub-alice", "alice");
    const bob = game.players.getOrCreate("sub-bob", "bob");
    game.playerSettings.set(alice.playerRef, 1, 1);
    game.playerSettings.set(alice.playerRef, 2, 0);
    game.playerSettings.set(bob.playerRef, 1, 0);
    await game.save();

    const restored = await makeGame([], store);
    assert.equal(await restored.load(), true);
    assert.equal(restored.playerSettings.get(alice.playerRef, 1), 1);
    assert.equal(restored.playerSettings.get(alice.playerRef, 2), 0);
    assert.equal(restored.playerSettings.get(bob.playerRef, 1), 0);
    assert.equal(restored.playerSettings.get(bob.playerRef, 2), undefined);
});

test("a player's custom tool order survives a save/load", async () => {
    const store = new NodeSaveStore(":memory:");
    const game = await makeGame([], store);
    const alice = game.players.getOrCreate("sub-alice", "alice");
    game.toolOrder.set(alice.playerRef, [30, -10, 20]);
    await game.save();

    const restored = await makeGame([], store);
    assert.equal(await restored.load(), true);
    assert.deepEqual(restored.toolOrder.get(alice.playerRef), [30, -10, 20]);
});

test("a snapshot without tables loads with empty registries", async () => {
    const store = new NodeSaveStore(":memory:");
    const seed = await makeGame([], store);
    // A pre-tables save: the raw engine snapshot, no tables section.
    await store.save(seed.simEngine.snapshots.serialize());

    const restored = await makeGame([], store);
    assert.equal(await restored.load(), true);
    assert.equal(restored.players.has(1), false);
    assert.equal(restored.claims.getCountByPlayerRef(1), 0);
});
