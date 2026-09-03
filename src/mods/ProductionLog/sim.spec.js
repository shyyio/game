import {test} from "node:test";
import assert from "node:assert/strict";
import {PLAYER_ID_NONE} from "@spup/sdk";
import {makeGame} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {
    ProductionLogRequestMessage,
    ItemLeaderboardRequestMessage,
} from "./common/messages.js";
import {
    ItemsDiscoveredEvent,
    ProductionLogEvent,
    ItemLeaderboardEvent,
} from "./common/events.js";
import {LEADERBOARD_PAGE_SIZE} from "./common/constants.js";

const IRON = 321;
const COAL = 322;

/**
 * A game with alice and bob connected.
 */
async function world() {
    const game = await makeGame();
    const alice = game.players.getOrCreate("sub-alice", "alice");
    const bob = game.players.getOrCreate("sub-bob", "bob");
    const aliceSession = new CapturingSession(alice.playerId);
    const bobSession = new CapturingSession(bob.playerId);
    game.connect(aliceSession);
    game.connect(bobSession);
    aliceSession.events.length = 0;
    bobSession.events.length = 0;
    return {game, alice: aliceSession, bob: bobSession};
}

function eventsOf(session, cls) {
    return session.events.filter(event => event instanceof cls);
}

function nameEventsOf(session) {
    return session.events.filter(event => event.usernames !== undefined);
}

test("a player's first production of each item type is announced once, batched per tick", async () => {
    const {game, alice, bob} = await world();
    game.simEngine.itemProduced.notify(alice.playerId, IRON, 1);
    game.simEngine.itemProduced.notify(alice.playerId, IRON, 1);
    game.simEngine.itemProduced.notify(alice.playerId, COAL, 1);
    game.simEngine.itemProduced.notify(PLAYER_ID_NONE, COAL, 1);
    assert.equal(eventsOf(alice, ItemsDiscoveredEvent).length, 0);

    game.runTick();
    const discovered = eventsOf(alice, ItemsDiscoveredEvent);
    assert.equal(discovered.length, 1);
    assert.deepEqual(discovered[0].itemTypes, [IRON, COAL]);
    assert.equal(eventsOf(bob, ItemsDiscoveredEvent).length, 0);

    game.simEngine.itemProduced.notify(alice.playerId, IRON, 1);
    game.runTick();
    assert.equal(eventsOf(alice, ItemsDiscoveredEvent).length, 1);
});

test("a production log request answers with the player's counts and ranks, their name first", async () => {
    const {game, alice, bob} = await world();
    game.simEngine.itemProduced.notify(alice.playerId, IRON, 2);
    game.simEngine.itemProduced.notify(alice.playerId, COAL, 1);
    game.simEngine.itemProduced.notify(bob.playerId, IRON, 9);

    game.dispatchMessage(new ProductionLogRequestMessage(alice.playerId), bob);
    const names = nameEventsOf(bob);
    assert.deepEqual(names[0].usernames, ["alice"]);
    const logs = eventsOf(bob, ProductionLogEvent);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].playerId, alice.playerId);
    assert.deepEqual(logs[0].itemTypes, [IRON, COAL]);
    assert.deepEqual(logs[0].counts, [2, 1]);
    assert.deepEqual(logs[0].ranks, [2, 1]);
    assert.ok(bob.events.indexOf(names[0]) < bob.events.indexOf(logs[0]));

    game.dispatchMessage(new ProductionLogRequestMessage(999), bob);
    assert.equal(eventsOf(bob, ProductionLogEvent).length, 1);
});

test("a leaderboard request answers one page with the requester's rank, names first", async () => {
    const {game, alice, bob} = await world();
    game.simEngine.itemProduced.notify(alice.playerId, IRON, 5);
    game.simEngine.itemProduced.notify(bob.playerId, IRON, 7);
    game.simEngine.itemProduced.notify(bob.playerId, COAL, 1);

    game.dispatchMessage(new ItemLeaderboardRequestMessage(IRON, 0), alice);
    const boards = eventsOf(alice, ItemLeaderboardEvent);
    assert.equal(boards.length, 1);
    assert.equal(boards[0].itemType, IRON);
    assert.deepEqual(boards[0].playerIds, [bob.playerId, alice.playerId]);
    assert.deepEqual(boards[0].scores, [7, 5]);
    assert.equal(boards[0].requesterRank, 2);
    assert.equal(boards[0].total, 2);
    const names = nameEventsOf(alice);
    assert.deepEqual(names[0].usernames, ["bob"]);
    assert.ok(alice.events.indexOf(names[0]) < alice.events.indexOf(boards[0]));

    game.dispatchMessage(new ItemLeaderboardRequestMessage(IRON, LEADERBOARD_PAGE_SIZE), alice);
    const page = eventsOf(alice, ItemLeaderboardEvent)[1];
    assert.deepEqual(page.playerIds, []);
    assert.equal(page.requesterRank, 2);
    assert.equal(page.total, 2);

    game.dispatchMessage(new ItemLeaderboardRequestMessage(COAL, 0), alice);
    assert.equal(eventsOf(alice, ItemLeaderboardEvent)[2].requesterRank, 0);
});
