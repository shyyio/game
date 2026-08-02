import {test} from "node:test";
import assert from "node:assert/strict";
import {PlayerRegistry} from "@/sim/PlayerRegistry.js";

test("getOrCreate is idempotent and allocates stable ids from 1", () => {
    const players = new PlayerRegistry();
    const alice = players.getOrCreate("sub-alice", "alice");
    const bob = players.getOrCreate("sub-bob", "bob");
    assert.equal(alice.playerId, 1);
    assert.equal(bob.playerId, 2);
    assert.equal(players.getOrCreate("sub-alice", "alice"), alice);
    assert.equal(players.byId(2), bob);
});

test("a returning sub is recognized even if the display name changed", () => {
    const players = new PlayerRegistry();
    const alice = players.getOrCreate("sub-alice", "alice");
    assert.equal(players.getOrCreate("sub-alice", "alice2").playerId, alice.playerId, "same identity, new display name");
});

test("an invalid sub is rejected; the display name is unconstrained", () => {
    const players = new PlayerRegistry();
    assert.throws(() => players.getOrCreate("", "alice"), RangeError, "empty sub");
    assert.throws(() => players.getOrCreate(null, "alice"), RangeError, "non-string sub");
    // Display names are cosmetic only now: no uniqueness, no pattern enforced by the registry.
    assert.equal(players.getOrCreate("sub-1", "not a valid username!!").username, "not a valid username!!");
});

test("unknown ids break loudly", () => {
    const players = new PlayerRegistry();
    assert.throws(() => players.byId(7), RangeError);
    assert.equal(players.has(7), false);
});

test("ensure registers external ids without disturbing the counter", () => {
    const players = new PlayerRegistry();
    const local = players.ensure(1);
    assert.equal(local.playerId, 1);
    assert.equal(players.ensure(1), local);
    // The next organic registration does not collide with the ensured id.
    assert.equal(players.getOrCreate("sub-alice", "alice").playerId, 2);
});

test("friend lists are one-directional and validated", () => {
    const players = new PlayerRegistry();
    const alice = players.getOrCreate("sub-alice", "alice");
    const bob = players.getOrCreate("sub-bob", "bob");
    players.addFriend(alice.playerId, bob.playerId);
    assert.equal(players.isFriend(alice.playerId, bob.playerId), true);
    assert.equal(players.isFriend(bob.playerId, alice.playerId), false);
    assert.throws(() => players.addFriend(alice.playerId, 99), RangeError);
    players.removeFriend(alice.playerId, bob.playerId);
    assert.equal(players.isFriend(alice.playerId, bob.playerId), false);
    assert.equal(players.isFriend(99, 1), false, "unknown owner is nobody's friend");
});

test("directory lists every player", () => {
    const players = new PlayerRegistry();
    players.getOrCreate("sub-alice", "alice");
    players.getOrCreate("sub-bob", "bob");
    const directory = players.directory();
    assert.deepEqual(directory.playerIds, [1, 2]);
    assert.deepEqual(directory.usernames, ["alice", "bob"]);
});

test("records round-trip and the id counter resumes past the loaded ids", () => {
    const players = new PlayerRegistry();
    const alice = players.getOrCreate("sub-alice", "alice");
    const bob = players.getOrCreate("sub-bob", "bob");
    alice.maxChunks = 12;
    players.addFriend(alice.playerId, bob.playerId);

    const [playerTable, friendTable] = players.serializeRecords();
    const restored = new PlayerRegistry();
    restored.deserializeRecords(playerTable, friendTable);
    assert.equal(restored.byId(1).username, "alice");
    assert.equal(restored.byId(1).maxChunks, 12);
    assert.equal(restored.isFriend(1, 2), true);
    assert.equal(restored.getOrCreate("sub-alice", "alice"), restored.byId(1), "sub survives the round-trip");
    assert.equal(restored.getOrCreate("sub-carol", "carol").playerId, 3);

    restored.deserializeRecords(undefined, undefined);
    assert.equal(restored.has(1), false);
    assert.equal(restored.getOrCreate("sub-dave", "dave").playerId, 1);
});

test("a locally-ensured record (no auth server involved) never collides on sub", () => {
    const players = new PlayerRegistry();
    players.ensure(1);
    players.ensure(2);
    // Both ensured records have sub=null; getOrCreate must not treat that as a shared identity.
    assert.equal(players.getOrCreate("sub-alice", "alice").playerId, 3);
});

test("friend codes are random, unique per player, and not tied to playerId", () => {
    const players = new PlayerRegistry();
    const alice = players.getOrCreate("sub-alice", "alice");
    const bob = players.getOrCreate("sub-bob", "bob");
    assert.notEqual(alice.friendCode, bob.friendCode);
    assert.equal(players.byFriendCode(alice.friendCode), alice);
    assert.equal(players.byFriendCode(bob.friendCode), bob);
});

test("byFriendCode is case/format-tolerant and returns undefined for an unknown or malformed code", () => {
    const players = new PlayerRegistry();
    const alice = players.getOrCreate("sub-alice", "alice");
    assert.equal(players.byFriendCode(alice.friendCode.toLowerCase()), alice);
    assert.equal(players.byFriendCode(alice.friendCode.replace("-", "")), alice);
    assert.equal(players.byFriendCode("not-a-code"), undefined);
});

test("friend codes survive a round-trip; a save from before friend codes existed gets one minted", () => {
    const players = new PlayerRegistry();
    const alice = players.getOrCreate("sub-alice", "alice");

    const [playerTable, friendTable] = players.serializeRecords();
    const restored = new PlayerRegistry();
    restored.deserializeRecords(playerTable, friendTable);
    assert.equal(restored.byId(1).friendCode, alice.friendCode);

    const [legacyTable] = players.serializeRecords();
    for (const row of legacyTable.rows) {
        delete row.friend_code;
    }
    const migrated = new PlayerRegistry();
    migrated.deserializeRecords(legacyTable, friendTable);
    assert.equal(typeof migrated.byId(1).friendCode, "string");
    assert.equal(migrated.byFriendCode(migrated.byId(1).friendCode), migrated.byId(1));
});
