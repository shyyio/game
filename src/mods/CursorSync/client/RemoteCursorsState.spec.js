import {test} from "node:test";
import assert from "node:assert/strict";
import {REMOTE_CURSORS_SCHEMA, RemoteCursorsWriter} from "./RemoteCursorsState.js";
import {PlayerCursorEvent, PlayerCursorHideEvent} from "../common/events.js";
import {CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_NONE, CURSOR_AUDIENCE_FRIENDS, CURSOR_AUDIENCE_EVERYONE} from "../common/constants.js";
import {WelcomeEvent, FriendListEvent} from "@/common/PlayerEvents.js";
import {ChunkUnsubscribeEvent} from "@/common/CoreEvents.js";
import {ClientCache, CHUNK_CLAIMS_SCHEMA, ChunkClaimsWriter, ChunkClaimsView} from "@/sdk/client.js";
import {PLAYER_SETTINGS_SCHEMA, PlayerSettingsWriter} from "@/sdk/client.js";
import {chunkId} from "@/common/util.js";

function stateWithOwnPlayer(ownPlayerId) {
    const state = new ClientCache();
    state.register("chunkClaims", CHUNK_CLAIMS_SCHEMA, new ChunkClaimsWriter(state), new ChunkClaimsView());
    state.register("playerSettings", PLAYER_SETTINGS_SCHEMA, new PlayerSettingsWriter(state));
    state.register("remoteCursors", REMOTE_CURSORS_SCHEMA, new RemoteCursorsWriter(state));
    state.onEvent(new WelcomeEvent(ownPlayerId, 9, "0001-2A3B"));
    const upserts = [];
    const removes = [];
    state.subscribe("remoteCursors.byPlayer", (playerId, cursor) => {
        if (cursor === undefined) {
            removes.push(playerId);
        } else {
            upserts.push(cursor);
        }
    });
    return {state, upserts, removes};
}

test("writes a cursor per event", () => {
    const {state, upserts} = stateWithOwnPlayer(1);
    state.onEvent(new PlayerCursorEvent(2, 4.5, -1.25));
    state.onEvent(new PlayerCursorEvent(2, 5.0, -1.0));
    assert.equal(upserts.length, 2);
    assert.equal(upserts[1].playerId, 2);
    assert.equal(upserts[1].x, 5.0);
    assert.deepEqual(state.mapGet("remoteCursors.byPlayer", 2), {playerId: 2, x: 5.0, y: -1.0});
});

test("drops the own player's echoed events", () => {
    const {state, upserts} = stateWithOwnPlayer(1);
    state.onEvent(new PlayerCursorEvent(1, 0, 0));
    assert.deepEqual(upserts, []);
});

test("a hide event removes its cursor; an unknown player's hide notifies nothing", () => {
    const {state, removes} = stateWithOwnPlayer(1);
    state.onEvent(new PlayerCursorEvent(2, 0, 0));
    state.onEvent(new PlayerCursorHideEvent(2));
    state.onEvent(new PlayerCursorHideEvent(9));
    assert.deepEqual(removes, [2]);
});

test("a chunk unsubscribe drops only its own cursors", () => {
    const {state, removes} = stateWithOwnPlayer(1);
    state.onEvent(new PlayerCursorEvent(2, 4.5, -1.25));
    state.onEvent(new PlayerCursorEvent(3, 200.5, 200.5));
    state.onEvent(new ChunkUnsubscribeEvent(chunkId(4.5, -1.25)));
    assert.deepEqual(removes, [2]);
});

test("displaying no cursors clears and gates; widening to everyone resumes", () => {
    const {state, upserts, removes} = stateWithOwnPlayer(1);
    state.onEvent(new PlayerCursorEvent(2, 0, 0));
    state.mapSet("playerSettings.values", CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_NONE);
    assert.deepEqual(removes, [2]);

    state.onEvent(new PlayerCursorEvent(3, 1, 1));
    assert.equal(upserts.length, 1, "updates are ignored while hidden");

    state.mapSet("playerSettings.values", CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_EVERYONE);
    state.onEvent(new PlayerCursorEvent(3, 1, 1));
    assert.equal(upserts.length, 2);
});

test("displaying friends only clears and gates non-friend cursors", () => {
    const {state, upserts, removes} = stateWithOwnPlayer(1);
    state.onEvent(new FriendListEvent([2], []));
    state.onEvent(new PlayerCursorEvent(2, 0, 0));
    state.onEvent(new PlayerCursorEvent(3, 1, 1));
    state.mapSet("playerSettings.values", CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_FRIENDS);
    assert.deepEqual(removes, [3], "only the non-friend cursor clears");

    state.onEvent(new PlayerCursorEvent(3, 2, 2));
    state.onEvent(new PlayerCursorEvent(2, 2, 2));
    assert.equal(upserts.length, 3, "the non-friend update is ignored, the friend's lands");
    assert.equal(upserts[2].playerId, 2);
});
