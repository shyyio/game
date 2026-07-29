import {test} from "node:test";
import assert from "node:assert/strict";
import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {Direction, PLAYER_ID_NONE} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {ClaimChunkMessage, UnclaimChunkMessage} from "@/common/ClaimMessages.js";
import {AddFriendMessage, RemoveFriendMessage} from "@/common/PlayerMessages.js";
import {ChunkClaimSyncEvent, ChunkClaimUpdateEvent, ClaimResultEvent, ClaimResult} from "@/common/ClaimEvents.js";
import {WelcomeEvent, PlayerDirectoryEvent, FriendListEvent} from "@/common/PlayerEvents.js";
import {DemoMachineType} from "@/mods/Demo/declaration.js";
import {ecsModRegistry} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";

const ALICE = 1;
const BOB = 2;

async function setup() {
    const modRegistry = ecsModRegistry();
    const game = new Game(modRegistry, new GameEngine(modRegistry));
    await game.init();
    const alice = new CapturingSession(ALICE);
    const bob = new CapturingSession(BOB);
    game.connect(alice);
    game.connect(bob);
    alice.events.length = 0;
    bob.events.length = 0;
    return {game, alice, bob};
}

function machineCount(game) {
    return game.simEngine.placed.eidsOf(DemoMachineType.typeId).length;
}

test("connect syncs identity, directory, claims, and friends", async () => {
    const modRegistry = ecsModRegistry();
    const game = new Game(modRegistry, new GameEngine(modRegistry));
    await game.init();
    const alice = new CapturingSession(ALICE);
    game.connect(alice);

    const welcome = alice.events.find(event => event instanceof WelcomeEvent);
    assert.equal(welcome.playerId, ALICE);
    assert.ok(welcome.maxChunks > 0);
    assert.ok(alice.events.some(event => event instanceof PlayerDirectoryEvent));
    assert.ok(alice.events.some(event => event instanceof ChunkClaimSyncEvent));
    assert.ok(alice.events.some(event => event instanceof FriendListEvent));
});

test("a claim broadcasts to every session and answers the requester", async () => {
    const {game, alice, bob} = await setup();
    const chunk = chunkId(5, 5);
    game.dispatchMessage(new ClaimChunkMessage(chunk), alice);

    const result = alice.events.find(event => event instanceof ClaimResultEvent);
    assert.equal(result.result, ClaimResult.CLAIM_RESULT_OK);
    const update = bob.events.find(event => event instanceof ChunkClaimUpdateEvent);
    assert.equal(update.chunk, chunk);
    assert.equal(update.playerId, ALICE);
});

test("a rejected claim answers only the requester", async () => {
    const {game, alice, bob} = await setup();
    const chunk = chunkId(5, 5);
    game.dispatchMessage(new ClaimChunkMessage(chunk), alice);
    bob.events.length = 0;
    game.dispatchMessage(new ClaimChunkMessage(chunk), bob);

    const result = bob.events.find(event => event instanceof ClaimResultEvent);
    assert.equal(result.result, ClaimResult.CLAIM_RESULT_OWNED);
    assert.ok(!bob.events.some(event => event instanceof ChunkClaimUpdateEvent));
});

test("building in an unclaimed chunk is rejected until claimed", async () => {
    const {game, alice} = await setup();
    game.dispatchMessage(new CreateObjectMessage(DemoMachineType.typeId, 5, 5, Direction.UP), alice);
    assert.equal(machineCount(game), 0, "unclaimed build rejected");

    game.dispatchMessage(new ClaimChunkMessage(chunkId(5, 5)), alice);
    game.dispatchMessage(new CreateObjectMessage(DemoMachineType.typeId, 5, 5, Direction.UP), alice);
    assert.equal(machineCount(game), 1, "claiming unlocks the chunk");
});

test("building in a foreign chunk is rejected until the owner grants it", async () => {
    const {game, alice, bob} = await setup();
    game.dispatchMessage(new ClaimChunkMessage(chunkId(5, 5)), alice);

    game.dispatchMessage(new CreateObjectMessage(DemoMachineType.typeId, 5, 5, Direction.UP), bob);
    assert.equal(machineCount(game), 0, "stranger's build rejected");

    game.dispatchMessage(new CreateObjectMessage(DemoMachineType.typeId, 5, 5, Direction.UP), alice);
    assert.equal(machineCount(game), 1, "owner builds freely");

    game.dispatchMessage(new AddFriendMessage(ALICE), bob);
    game.dispatchMessage(new CreateObjectMessage(DemoMachineType.typeId, 10, 5, Direction.UP), bob);
    assert.equal(machineCount(game), 1, "bob's own grant to alice gives him nothing");

    game.dispatchMessage(new AddFriendMessage(BOB), alice);
    game.dispatchMessage(new CreateObjectMessage(DemoMachineType.typeId, 10, 5, Direction.UP), bob);
    assert.equal(machineCount(game), 2, "alice's grant lets bob build");
});

test("a friendship change resyncs both players' lists", async () => {
    const {game, alice, bob} = await setup();
    game.dispatchMessage(new AddFriendMessage(BOB), alice);

    const aliceList = alice.events.filter(event => event instanceof FriendListEvent).at(-1);
    assert.deepEqual(aliceList.friendIds, [BOB]);
    assert.deepEqual(aliceList.grantedByIds, []);
    const bobList = bob.events.filter(event => event instanceof FriendListEvent).at(-1);
    assert.deepEqual(bobList.friendIds, []);
    assert.deepEqual(bobList.grantedByIds, [ALICE], "bob learns alice granted him build rights");

    bob.events.length = 0;
    game.dispatchMessage(new RemoveFriendMessage(BOB), alice);
    const revoked = bob.events.filter(event => event instanceof FriendListEvent).at(-1);
    assert.deepEqual(revoked.grantedByIds, [], "bob learns the grant was revoked");
});

test("deleting in a foreign chunk is rejected and leaves occupancy intact", async () => {
    const {game, alice, bob} = await setup();
    const engine = game.simEngine;
    game.dispatchMessage(new ClaimChunkMessage(chunkId(5, 5)), alice);
    game.dispatchMessage(new CreateObjectMessage(DemoMachineType.typeId, 5, 5, Direction.UP), alice);
    const eid = engine.placed.eidsOf(DemoMachineType.typeId)[0];
    const objectId = engine.placed.objectIdOf(eid);
    const footprint = engine.footprint(DemoMachineType, 5, 5, Direction.UP);

    game.dispatchMessage(new DeleteObjectMessage(objectId), bob);
    assert.equal(machineCount(game), 1, "stranger's delete rejected");
    assert.equal(engine.cellsFree(footprint), false, "occupancy untouched by the rejected delete");

    game.dispatchMessage(new DeleteObjectMessage(objectId), alice);
    assert.equal(machineCount(game), 0, "owner deletes freely");
    assert.equal(engine.cellsFree(footprint), true);
});

test("unclaiming a non-empty chunk needs the clear confirmation, which deletes the objects", async () => {
    const {game, alice} = await setup();
    const chunk = chunkId(5, 5);
    game.dispatchMessage(new ClaimChunkMessage(chunk), alice);
    game.dispatchMessage(new CreateObjectMessage(DemoMachineType.typeId, 5, 5, Direction.UP), alice);
    alice.events.length = 0;

    game.dispatchMessage(new UnclaimChunkMessage(chunk), alice);
    const rejected = alice.events.find(event => event instanceof ClaimResultEvent);
    assert.equal(rejected.result, ClaimResult.CLAIM_RESULT_NOT_EMPTY);
    assert.equal(game.claims.ownerOf(chunk), ALICE, "still claimed");
    assert.equal(machineCount(game), 1, "nothing deleted on the rejection");

    game.dispatchMessage(new UnclaimChunkMessage(chunk, true), alice);
    assert.equal(game.claims.ownerOf(chunk), PLAYER_ID_NONE);
    assert.equal(machineCount(game), 0, "the confirmation cleared the chunk");
});

test("a splitting unclaim rejects with WOULD_SPLIT before the non-empty confirmation", async () => {
    const {game, alice} = await setup();
    const middle = chunkId(69, 5);
    game.dispatchMessage(new ClaimChunkMessage(chunkId(5, 5)), alice);
    game.dispatchMessage(new ClaimChunkMessage(middle), alice);
    game.dispatchMessage(new ClaimChunkMessage(chunkId(133, 5)), alice);
    game.dispatchMessage(new CreateObjectMessage(DemoMachineType.typeId, 69, 5, Direction.UP), alice);
    alice.events.length = 0;

    game.dispatchMessage(new UnclaimChunkMessage(middle), alice);
    const rejected = alice.events.find(event => event instanceof ClaimResultEvent);
    assert.equal(rejected.result, ClaimResult.CLAIM_RESULT_WOULD_SPLIT);
    assert.equal(game.claims.ownerOf(middle), ALICE, "still claimed");
    assert.equal(machineCount(game), 1, "nothing deleted");
});

test("unclaim frees the chunk for other players", async () => {
    const {game, alice, bob} = await setup();
    const chunk = chunkId(5, 5);
    game.dispatchMessage(new ClaimChunkMessage(chunk), alice);
    game.dispatchMessage(new UnclaimChunkMessage(chunk), alice);

    const update = bob.events.filter(event => event instanceof ChunkClaimUpdateEvent).at(-1);
    assert.equal(update.playerId, PLAYER_ID_NONE);
    game.dispatchMessage(new ClaimChunkMessage(chunk), bob);
    game.dispatchMessage(new CreateObjectMessage(DemoMachineType.typeId, 5, 5, Direction.UP), bob);
    assert.equal(machineCount(game), 1);
});
