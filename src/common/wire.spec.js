import {test} from "node:test";
import assert from "node:assert";

import {ModRegistry} from "@/common/ModRegistry.js";
import {WireRegistry} from "@/common/wire.js";

import {SetViewportMessage, SetInspectedObjectsMessage, OverworldRequestMessage} from "@/common/CoreMessages.js";
import {OverworldSnapshotEvent} from "@/common/OverworldEvents.js";
import {PortItemSetEvent, PortItemBatchEvent} from "@/common/PortItemEvents.js";
import {PlayerSettingsSyncEvent, PlayerSettingsUpdateEvent} from "@/common/PlayerSettingsEvents.js";
import {GameSettingsSyncEvent, GameSettingsUpdateEvent} from "@/common/GameSettingsEvents.js";
import {ChunkSubscribeEvent, ChunkUnsubscribeEvent, ChunkSyncEvent} from "@/common/CoreEvents.js";
import {
    SignInMessage, AddFriendMessage, AddFriendByCodeMessage, RemoveFriendMessage, SetPlayerSettingMessage,
} from "@/common/PlayerMessages.js";
import {
    WelcomeEvent, PlayerNamesEvent, FriendListEvent, AddFriendByCodeResultEvent,
} from "@/common/PlayerEvents.js";
import {ClaimChunkMessage, UnclaimChunkMessage, SetChunkPermissionMessage} from "@/common/ClaimMessages.js";
import {OwnClaimsSyncEvent, ChunkClaimUpdateEvent, ClaimResultEvent, ChunkPermission} from "@/common/ClaimEvents.js";
import {ClaimResult} from "@/common/ClaimEvents.js";
import {GAME_VERSION, PLAYER_ID_NONE} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";

// Core-only registry: common/ must not depend on mods/. Mod wire classes are
// covered by their own specs (e.g. src/mods/Logistics/wire.spec.js).
function registry() {
    const modRegistry = new ModRegistry();
    modRegistry.freeze();
    return new WireRegistry(modRegistry);
}

/**
 * Reduces an object to its declared wire fields, mapping undefined → null so
 * absent-on-the-wire fields compare equal to the source.
 */
function pick(obj, cls) {
    const out = {};
    for (const key of Object.keys(cls.wireFields)) {
        out[key] = obj[key] === undefined ? null : obj[key];
    }
    return out;
}

function roundTrip(reg, instance, cls) {
    const decoded = reg.decode(reg.encode(instance));
    assert.ok(decoded instanceof cls, `decoded value is not a ${cls.name}`);
    assert.deepStrictEqual(pick(decoded, cls), pick(instance, cls));
}

test("Round-trips a SetViewportMessage", () => {
    const reg = registry();
    roundTrip(reg, new SetViewportMessage([0, 1, chunkId(-64, 128)]), SetViewportMessage);
});

test("Round-trips a PortItemSetEvent with a port id", () => {
    const reg = registry();
    roundTrip(reg, new PortItemSetEvent(12, -5, 999999999999, 8), PortItemSetEvent);
});

test("Round-trips a PortItemBatchEvent's packed columns", () => {
    const reg = registry();
    const batch = new PortItemBatchEvent(12, -5);
    batch.addClear(999999999999);
    batch.addSet(41, 8);
    batch.addSet(42, 0);
    roundTrip(reg, batch, PortItemBatchEvent);
});

test("Round-trips chunk subscribe/unsubscribe events, recovering the chunk id", () => {
    const reg = registry();
    const chunk = chunkId(128, -192);
    roundTrip(reg, new ChunkSubscribeEvent(chunk), ChunkSubscribeEvent);
    roundTrip(reg, new ChunkUnsubscribeEvent(chunk), ChunkUnsubscribeEvent);
    // The chunk id is wired directly.
    const decoded = reg.decode(reg.encode(new ChunkUnsubscribeEvent(chunk)));
    assert.strictEqual(decoded.chunk, chunk);
});

test("ChunkSyncEvent round-trips its bundle of polymorphic inner events", () => {
    const reg = registry();
    const chunk = chunkId(128, -192);
    const inner = [
        new ChunkSubscribeEvent(chunk),
        new GameSettingsUpdateEvent(7, 70),
    ];
    const decoded = reg.decode(reg.encode(new ChunkSyncEvent(chunk, inner)));

    assert.ok(decoded instanceof ChunkSyncEvent);
    assert.strictEqual(decoded.chunk, chunk);
    assert.strictEqual(decoded.events.length, 2);
    assert.ok(decoded.events[0] instanceof ChunkSubscribeEvent);
    assert.strictEqual(decoded.events[0].chunk, chunk);
    assert.ok(decoded.events[1] instanceof GameSettingsUpdateEvent);
    assert.strictEqual(decoded.events[1].key, 7);
    assert.strictEqual(decoded.events[1].value, 70);
});

test("Round-trips player/game settings events", () => {
    const reg = registry();
    roundTrip(reg, new PlayerSettingsSyncEvent({1: 10, 2: 20}), PlayerSettingsSyncEvent);
    roundTrip(reg, new PlayerSettingsUpdateEvent(5, 50), PlayerSettingsUpdateEvent);
    roundTrip(reg, new GameSettingsSyncEvent({3: 30}), GameSettingsSyncEvent);
    roundTrip(reg, new GameSettingsUpdateEvent(7, 70), GameSettingsUpdateEvent);
});

test("Decoded id is a Number, round-tripped exactly", () => {
    const reg = registry();
    const id = 999999999999;
    const decoded = reg.decode(reg.encode(new PortItemSetEvent(0, 0, id, 1)));
    assert.strictEqual(typeof decoded.portId, "number");
    assert.strictEqual(decoded.portId, id);
});

test("Repeated int64 decodes to Numbers, exact up to the 2^53 cap", () => {
    const reg = registry();
    const ids = [1, 999999999999, Number.MAX_SAFE_INTEGER];
    const decoded = reg.decode(reg.encode(new SetInspectedObjectsMessage(ids)));
    for (const id of decoded.objectIds) {
        assert.strictEqual(typeof id, "number");
    }
    assert.deepStrictEqual(decoded.objectIds, ids);
});

test("Throws on an unregistered class", () => {
    const reg = registry();
    class Bogus {}
    assert.throws(() => reg.encode(new Bogus()), /No wire codec/);
});

test("Round-trips an OverworldRequestMessage", () => {
    const reg = registry();
    roundTrip(reg, new OverworldRequestMessage(-3, 7, 4, 4), OverworldRequestMessage);
});

test("Round-trips an OverworldSnapshotEvent's flattened run and claim columns", () => {
    const reg = registry();
    const event = new OverworldSnapshotEvent(-2, -2, 4, 4);
    event.addChunk(8128, [131, 650], [1, 2], [4, 9]);
    event.addChunk(8129, [0], [64], [4]);
    event.claimedChunks = [8128, 8200];
    event.claimOwners = [1, 2];
    event.claimPermissions = [ChunkPermission.PERMISSION_FRIENDS, ChunkPermission.PERMISSION_ONLY_ME];
    roundTrip(reg, event, OverworldSnapshotEvent);
});

test("Round-trips the player messages", () => {
    const reg = registry();
    roundTrip(reg, new SignInMessage(GAME_VERSION, "signed.jwt.token"), SignInMessage);
    roundTrip(reg, new AddFriendMessage(7), AddFriendMessage);
    roundTrip(reg, new AddFriendByCodeMessage("0001-2A3B"), AddFriendByCodeMessage);
    roundTrip(reg, new RemoveFriendMessage(999999999999), RemoveFriendMessage);
});

test("Round-trips the player events", () => {
    const reg = registry();
    roundTrip(reg, new WelcomeEvent(7, 9), WelcomeEvent);
    roundTrip(reg, new PlayerNamesEvent([1, 2], ["alice", "bob"]), PlayerNamesEvent);
    roundTrip(reg, new PlayerNamesEvent([], []), PlayerNamesEvent);
    roundTrip(reg, new FriendListEvent([], []), FriendListEvent);
    roundTrip(reg, new FriendListEvent([3, 4, 5], [6, 7]), FriendListEvent);
    roundTrip(reg, new AddFriendByCodeResultEvent("0001-2A3B", true), AddFriendByCodeResultEvent);
    roundTrip(reg, new AddFriendByCodeResultEvent("nobody", false), AddFriendByCodeResultEvent);
});

test("Round-trips the claim messages and events", () => {
    const reg = registry();
    roundTrip(reg, new ClaimChunkMessage(0), ClaimChunkMessage);
    roundTrip(reg, new UnclaimChunkMessage(8256), UnclaimChunkMessage);
    roundTrip(reg, new UnclaimChunkMessage(8256, true), UnclaimChunkMessage);
    roundTrip(reg, new SetChunkPermissionMessage(8256, ChunkPermission.PERMISSION_ONLY_ME), SetChunkPermissionMessage);
    roundTrip(reg, new OwnClaimsSyncEvent([], []), OwnClaimsSyncEvent);
    roundTrip(
        reg,
        new OwnClaimsSyncEvent([8256, 8257], [ChunkPermission.PERMISSION_FRIENDS, ChunkPermission.PERMISSION_ONLY_ME]),
        OwnClaimsSyncEvent,
    );
    roundTrip(reg, new ChunkClaimUpdateEvent(8256, PLAYER_ID_NONE), ChunkClaimUpdateEvent);
    roundTrip(
        reg,
        new ChunkClaimUpdateEvent(8256, 7, ChunkPermission.PERMISSION_ONLY_ME),
        ChunkClaimUpdateEvent,
    );
    roundTrip(reg, new ClaimResultEvent(8256, ClaimResult.CLAIM_RESULT_WOULD_SPLIT), ClaimResultEvent);
});

test("Overworld request validation gates dimensions and region bounds", () => {
    assert.strictEqual(new OverworldRequestMessage(-3, 7, 4, 4).validate(null, null), true);
    assert.strictEqual(new OverworldRequestMessage(-3, 7, 0, 4).validate(null, null), false);
    assert.strictEqual(new OverworldRequestMessage(-100000, 0, 4, 4).validate(null, null), false);
    assert.strictEqual(new OverworldRequestMessage(62, 0, 4, 4).validate(null, null), false, "rect crosses the region edge");
});

test("Sign-in validation gates version and token presence", () => {
    assert.strictEqual(new SignInMessage(GAME_VERSION, "signed.jwt.token").validate(null, null), true);
    assert.strictEqual(new SignInMessage(`${GAME_VERSION}-stale`, "signed.jwt.token").validate(null, null), false);
    assert.strictEqual(new SignInMessage(GAME_VERSION, "").validate(null, null), false, "empty token");
    assert.strictEqual(new SignInMessage(GAME_VERSION, null).validate(null, null), false);
});

test("Round-trips a SetPlayerSettingMessage", () => {
    const reg = registry();
    roundTrip(reg, new SetPlayerSettingMessage(1, 1), SetPlayerSettingMessage);
});
