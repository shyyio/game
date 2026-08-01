import {test} from "node:test";
import assert from "node:assert/strict";
import {PlayerRegistry} from "@/sim/PlayerRegistry.js";

test("getOrCreate is idempotent and allocates stable ids from 1", () => {
    const players = new PlayerRegistry();
    const alice = players.getOrCreate("alice");
    const bob = players.getOrCreate("bob");
    assert.equal(alice.playerId, 1);
    assert.equal(bob.playerId, 2);
    assert.equal(players.getOrCreate("alice"), alice);
    assert.equal(players.byId(2), bob);
    assert.equal(players.findByUsername("carol"), null);
});

test("invalid usernames are rejected", () => {
    const players = new PlayerRegistry();
    assert.throws(() => players.getOrCreate(" alice"), RangeError, "leading space");
    assert.throws(() => players.getOrCreate("alice "), RangeError, "trailing space");
    assert.throws(() => players.getOrCreate("ali  ce"), RangeError, "double space");
    assert.throws(() => players.getOrCreate("ab"), RangeError);
    assert.throws(() => players.getOrCreate("x".repeat(13)), RangeError);
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
    assert.equal(players.getOrCreate("alice").playerId, 2);
});

test("friend lists are one-directional and validated", () => {
    const players = new PlayerRegistry();
    const alice = players.getOrCreate("alice");
    const bob = players.getOrCreate("bob");
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
    players.getOrCreate("alice");
    players.getOrCreate("bob");
    const directory = players.directory();
    assert.deepEqual(directory.playerIds, [1, 2]);
    assert.deepEqual(directory.usernames, ["alice", "bob"]);
});

test("records round-trip and the id counter resumes past the loaded ids", () => {
    const players = new PlayerRegistry();
    const alice = players.getOrCreate("alice");
    const bob = players.getOrCreate("bob");
    alice.maxChunks = 12;
    players.addFriend(alice.playerId, bob.playerId);

    const [playerTable, friendTable] = players.serializeRecords();
    const restored = new PlayerRegistry();
    restored.deserializeRecords(playerTable, friendTable);
    assert.equal(restored.byId(1).username, "alice");
    assert.equal(restored.byId(1).maxChunks, 12);
    assert.equal(restored.isFriend(1, 2), true);
    assert.equal(restored.getOrCreate("carol").playerId, 3);

    restored.deserializeRecords(undefined, undefined);
    assert.equal(restored.has(1), false);
    assert.equal(restored.getOrCreate("dave").playerId, 1);
});
