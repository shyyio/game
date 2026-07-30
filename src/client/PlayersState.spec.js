import {test} from "node:test";
import assert from "node:assert/strict";
import {ClientCache} from "@/client/ClientCache.js";
import {PLAYERS_SCHEMA, PlayersWriter, PlayersView} from "@/client/PlayersState.js";
import {PlayerNamesEvent} from "@/common/PlayerEvents.js";

function playersState() {
    const state = new ClientCache();
    state.register("players", PLAYERS_SCHEMA, new PlayersWriter(state), new PlayersView());
    return {state, players: state.view("players")};
}

test("name events fill the map, unknown ids fall back to a synthetic name", () => {
    const {state, players} = playersState();
    state.onEvent(new PlayerNamesEvent([1, 3], ["alice", "carol"]));
    assert.equal(players.usernameOf(1), "alice");
    assert.equal(players.usernameOf(3), "carol");
    assert.equal(players.usernameOf(9), "player9");
});

test("a repeated id overwrites, so a rename applies instantly", () => {
    const {state, players} = playersState();
    const touched = [];
    state.subscribe("players.usernameByPlayer", (playerId, username) => touched.push([playerId, username]));

    state.onEvent(new PlayerNamesEvent([1], ["alice"]));
    state.onEvent(new PlayerNamesEvent([1], ["alicia"]));
    assert.equal(players.usernameOf(1), "alicia");
    assert.deepEqual(touched, [[1, "alice"], [1, "alicia"]], "subscribers see the rename");
});
