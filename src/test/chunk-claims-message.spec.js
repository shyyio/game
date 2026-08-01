import {test} from "node:test";
import assert from "node:assert/strict";
import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {Direction, PLAYER_ID_NONE} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";
import {CreateObjectMessage, DeleteObjectMessage, SetViewportMessage} from "@/common/CoreMessages.js";
import {ClaimChunkMessage, UnclaimChunkMessage, SetChunkPermissionMessage} from "@/common/ClaimMessages.js";
import {AddFriendMessage, AddFriendByUsernameMessage, RemoveFriendMessage} from "@/common/PlayerMessages.js";
import {
    OwnClaimsSyncEvent, ChunkClaimUpdateEvent, ClaimResultEvent, ClaimResult, ChunkPermission,
} from "@/common/ClaimEvents.js";
import {
    WelcomeEvent, PlayerNamesEvent, FriendListEvent, AddFriendByUsernameResultEvent,
} from "@/common/PlayerEvents.js";
import {syntheticUsername} from "@/common/util.js";
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

test("connect syncs identity, the own name, own claims, and friends", async () => {
    const modRegistry = ecsModRegistry();
    const game = new Game(modRegistry, new GameEngine(modRegistry));
    await game.init();
    const alice = new CapturingSession(ALICE);
    game.connect(alice);

    const welcome = alice.events.find(event => event instanceof WelcomeEvent);
    assert.equal(welcome.playerId, ALICE);
    assert.ok(welcome.maxChunks > 0);
    const names = alice.events.find(event => event instanceof PlayerNamesEvent);
    assert.deepEqual(names.playerIds, [ALICE], "only the own name arrives on connect");
    assert.ok(alice.events.some(event => event instanceof OwnClaimsSyncEvent));
    assert.ok(alice.events.some(event => event instanceof FriendListEvent));
});

test("a claim reaches the chunk's viewers, name first, and skips the rest", async () => {
    const {game, alice, bob} = await setup();
    const chunk = chunkId(5, 5);
    game.dispatchMessage(new SetViewportMessage([chunk]), bob);
    bob.events.length = 0;
    game.dispatchMessage(new ClaimChunkMessage(chunk), alice);

    const result = alice.events.find(event => event instanceof ClaimResultEvent);
    assert.equal(result.result, ClaimResult.CLAIM_RESULT_OK);
    const nameIndex = bob.events.findIndex(
        event => event instanceof PlayerNamesEvent && event.playerIds.includes(ALICE),
    );
    const updateIndex = bob.events.findIndex(event => event instanceof ChunkClaimUpdateEvent);
    assert.ok(nameIndex >= 0, "the viewer learns the owner's name");
    assert.ok(updateIndex > nameIndex, "the name precedes the update");
    const update = bob.events[updateIndex];
    assert.equal(update.chunk, chunk);
    assert.equal(update.playerId, ALICE);

    const charlie = new CapturingSession(3);
    game.connect(charlie);
    charlie.events.length = 0;
    game.dispatchMessage(new ClaimChunkMessage(chunkId(69, 5)), alice);
    assert.ok(
        !charlie.events.some(event => event instanceof ChunkClaimUpdateEvent),
        "a session without the chunk in view hears nothing",
    );
});

test("the acting player's session gets the update without viewing the chunk", async () => {
    const {game, alice} = await setup();
    const chunk = chunkId(5, 5);
    game.dispatchMessage(new ClaimChunkMessage(chunk), alice);

    const update = alice.events.find(event => event instanceof ChunkClaimUpdateEvent);
    assert.equal(update.chunk, chunk);
    assert.equal(update.playerId, ALICE);
});

test("a viewport gaining a claimed chunk is seeded its claim and owner name", async () => {
    const {game, alice, bob} = await setup();
    const chunk = chunkId(5, 5);
    game.dispatchMessage(new ClaimChunkMessage(chunk), alice);
    game.dispatchMessage(new SetViewportMessage([chunk]), bob);

    const names = bob.events.find(event => event instanceof PlayerNamesEvent);
    assert.deepEqual(names.playerIds, [ALICE]);
    const update = bob.events.find(event => event instanceof ChunkClaimUpdateEvent);
    assert.equal(update.chunk, chunk);
    assert.equal(update.playerId, ALICE);

    // Leaving and returning re-seeds the claim, but a known name never resends.
    bob.events.length = 0;
    game.dispatchMessage(new SetViewportMessage([]), bob);
    game.dispatchMessage(new SetViewportMessage([chunk]), bob);
    assert.ok(bob.events.some(event => event instanceof ChunkClaimUpdateEvent));
    assert.ok(!bob.events.some(event => event instanceof PlayerNamesEvent));
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

test("a claim defaults to friends-only permission", async () => {
    const {game, alice} = await setup();
    const chunk = chunkId(5, 5);
    game.dispatchMessage(new ClaimChunkMessage(chunk), alice);
    assert.equal(game.claims.permissionOf(chunk), ChunkPermission.PERMISSION_FRIENDS);
});

test("only-me permission blocks a friend-granted player", async () => {
    const {game, alice, bob} = await setup();
    const chunk = chunkId(5, 5);
    game.dispatchMessage(new ClaimChunkMessage(chunk), alice);
    game.dispatchMessage(new AddFriendMessage(BOB), alice);
    game.dispatchMessage(new CreateObjectMessage(DemoMachineType.typeId, 5, 5, Direction.UP), bob);
    assert.equal(machineCount(game), 1, "the grant lets bob build under the friends-only default");

    game.dispatchMessage(new SetChunkPermissionMessage(chunk, ChunkPermission.PERMISSION_ONLY_ME), alice);
    game.dispatchMessage(new CreateObjectMessage(DemoMachineType.typeId, 10, 5, Direction.UP), bob);
    assert.equal(machineCount(game), 1, "only-me overrides bob's existing grant");
});

test("a non-owner's permission change is ignored", async () => {
    const {game, alice, bob} = await setup();
    const chunk = chunkId(5, 5);
    game.dispatchMessage(new ClaimChunkMessage(chunk), alice);

    game.dispatchMessage(new SetChunkPermissionMessage(chunk, ChunkPermission.PERMISSION_ONLY_ME), bob);
    assert.equal(game.claims.permissionOf(chunk), ChunkPermission.PERMISSION_FRIENDS, "bob owns nothing here");
});

test("a permission change reaches the chunk's viewers", async () => {
    const {game, alice, bob} = await setup();
    const chunk = chunkId(5, 5);
    game.dispatchMessage(new SetViewportMessage([chunk]), bob);
    game.dispatchMessage(new ClaimChunkMessage(chunk), alice);
    bob.events.length = 0;

    game.dispatchMessage(new SetChunkPermissionMessage(chunk, ChunkPermission.PERMISSION_ONLY_ME), alice);
    const update = bob.events.find(event => event instanceof ChunkClaimUpdateEvent);
    assert.equal(update.chunk, chunk);
    assert.equal(update.playerId, ALICE);
    assert.equal(update.permission, ChunkPermission.PERMISSION_ONLY_ME);
});

test("a friendship change resyncs both players' lists, names first", async () => {
    const {game, alice, bob} = await setup();
    game.dispatchMessage(new AddFriendMessage(BOB), alice);

    const aliceList = alice.events.filter(event => event instanceof FriendListEvent).at(-1);
    assert.deepEqual(aliceList.friendIds, [BOB]);
    assert.deepEqual(aliceList.grantedByIds, []);
    const bobNames = bob.events.find(event => event instanceof PlayerNamesEvent);
    assert.deepEqual(bobNames.playerIds, [ALICE], "bob learns his granter's name");
    const bobList = bob.events.filter(event => event instanceof FriendListEvent).at(-1);
    assert.deepEqual(bobList.friendIds, []);
    assert.deepEqual(bobList.grantedByIds, [ALICE], "bob learns alice granted him build rights");

    bob.events.length = 0;
    game.dispatchMessage(new RemoveFriendMessage(BOB), alice);
    const revoked = bob.events.filter(event => event instanceof FriendListEvent).at(-1);
    assert.deepEqual(revoked.grantedByIds, [], "bob learns the grant was revoked");
});

test("add-friend-by-username resolves the username before granting, and answers found", async () => {
    const {game, alice} = await setup();
    game.dispatchMessage(new AddFriendByUsernameMessage(syntheticUsername(2)), alice);

    const aliceList = alice.events.filter(event => event instanceof FriendListEvent).at(-1);
    assert.deepEqual(aliceList.friendIds, [2]);
    const result = alice.events.find(event => event instanceof AddFriendByUsernameResultEvent);
    assert.equal(result.username, syntheticUsername(2));
    assert.equal(result.found, 1);
});

test("add-friend-by-username on an unknown username is silently ignored, and answers not found", async () => {
    const {game, alice} = await setup();
    alice.events.length = 0;
    game.dispatchMessage(new AddFriendByUsernameMessage("nobodyhome"), alice);

    assert.deepEqual(game.players.byId(ALICE).friends, new Set());
    const aliceList = alice.events.filter(event => event instanceof FriendListEvent).at(-1);
    assert.deepEqual(aliceList.friendIds, [], "the unchanged list still re-sends");
    const result = alice.events.find(event => event instanceof AddFriendByUsernameResultEvent);
    assert.equal(result.username, "nobodyhome");
    assert.equal(result.found, 0);
});

test("add-friend-by-username on your own username answers not found", async () => {
    const {game, alice} = await setup();
    game.dispatchMessage(new AddFriendByUsernameMessage(syntheticUsername(ALICE)), alice);

    const result = alice.events.find(event => event instanceof AddFriendByUsernameResultEvent);
    assert.equal(result.found, 0);
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

test("unclaim frees the chunk for other players and tells its viewers", async () => {
    const {game, alice, bob} = await setup();
    const chunk = chunkId(5, 5);
    game.dispatchMessage(new SetViewportMessage([chunk]), bob);
    game.dispatchMessage(new ClaimChunkMessage(chunk), alice);
    game.dispatchMessage(new UnclaimChunkMessage(chunk), alice);

    const update = bob.events.filter(event => event instanceof ChunkClaimUpdateEvent).at(-1);
    assert.equal(update.playerId, PLAYER_ID_NONE);
    game.dispatchMessage(new ClaimChunkMessage(chunk), bob);
    game.dispatchMessage(new CreateObjectMessage(DemoMachineType.typeId, 5, 5, Direction.UP), bob);
    assert.equal(machineCount(game), 1);
});
