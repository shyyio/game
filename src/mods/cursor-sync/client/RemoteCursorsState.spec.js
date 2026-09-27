import {test} from "node:test";
import assert from "node:assert/strict";
import {REMOTE_CURSORS_SCHEMA, RemoteCursorsWriter} from "./RemoteCursorsState.js";
import {
    PlayerCursorEvent, PlayerCursorHideEvent, PlayerSelectionStartEvent, PlayerSelectionEndEvent, PlayerPasteEvent, PlayerPasteClearEvent,
} from "../common/events.js";
import {CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_NONE, CURSOR_AUDIENCE_FRIENDS, CURSOR_AUDIENCE_EVERYONE} from "../common/constants.js";
import {
    WelcomeEvent, FriendListEvent, ChunkUnsubscribeEvent, chunkKeyAt,
    ClientCache, CHUNK_CLAIMS_SCHEMA, ChunkClaimsWriter, ChunkClaimsView,
    PLAYER_SETTINGS_SCHEMA, PlayerSettingsWriter,
} from "@spup/sdk/client";

function stateWithOwnPlayer(ownPlayerRef) {
    const state = new ClientCache();
    state.register("chunkClaims", CHUNK_CLAIMS_SCHEMA, new ChunkClaimsWriter(state), new ChunkClaimsView());
    state.register("playerSettings", PLAYER_SETTINGS_SCHEMA, new PlayerSettingsWriter(state));
    state.register("remoteCursors", REMOTE_CURSORS_SCHEMA, new RemoteCursorsWriter(state));
    state.onEvent(new WelcomeEvent(ownPlayerRef, 9, "0001-2A3B"));
    const upserts = [];
    const removes = [];
    state.subscribe("remoteCursors.byPlayer", (playerRef, cursor) => {
        if (cursor === undefined) {
            removes.push(playerRef);
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
    assert.equal(upserts[1].playerRef, 2);
    assert.equal(upserts[1].x, 5.0);
    assert.deepEqual(state.mapGet("remoteCursors.byPlayer", 2), {playerRef: 2, x: 5.0, y: -1.0});
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
    state.onEvent(new ChunkUnsubscribeEvent(chunkKeyAt(4.5, -1.25)));
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
    assert.equal(upserts[2].playerRef, 2);
});

test("a player's preview mirrors its events and goes with their cursor", () => {
    const {state} = stateWithOwnPlayer(1);
    state.onEvent(new PlayerCursorEvent(2, 4.5, 3.5));
    state.onEvent(new PlayerSelectionStartEvent(2, 1.5, 2.5, 40));
    state.onEvent(new PlayerPasteEvent(2, 3, [2, 3]));
    assert.deepEqual(state.mapGet("remoteCursors.selectionByPlayer", 2), {playerRef: 2, x: 1.5, y: 2.5, toolId: 40});
    assert.deepEqual(state.mapGet("remoteCursors.pasteByPlayer", 2), {
        playerRef: 2,
        tileWidth: 3,
        tileHeight: 2,
        rowRuns: [{tileX: 2, tileY: 0, tileLength: 1}, {tileX: 0, tileY: 1, tileLength: 2}],
    });

    state.onEvent(new PlayerSelectionEndEvent(2));
    state.onEvent(new PlayerPasteClearEvent(2));
    assert.equal(state.mapGet("remoteCursors.selectionByPlayer", 2), undefined);
    assert.equal(state.mapGet("remoteCursors.pasteByPlayer", 2), undefined);

    state.onEvent(new PlayerSelectionStartEvent(2, 1.5, 2.5, 40));
    state.onEvent(new PlayerCursorHideEvent(2));
    assert.equal(state.mapGet("remoteCursors.selectionByPlayer", 2), undefined, "a hide drops the preview");

    state.onEvent(new PlayerCursorEvent(2, 4.5, 3.5));
    state.onEvent(new PlayerPasteEvent(2, 3, [2, 3]));
    state.onEvent(new ChunkUnsubscribeEvent(chunkKeyAt(4.5, 3.5)));
    assert.equal(state.mapGet("remoteCursors.pasteByPlayer", 2), undefined, "an unsubscribe drops the preview");
});

test("narrowing the display setting drops the previews it no longer admits", () => {
    const {state} = stateWithOwnPlayer(1);
    state.onEvent(new PlayerCursorEvent(2, 4.5, 3.5));
    state.onEvent(new PlayerPasteEvent(2, 3, [2, 3]));
    state.mapSet("playerSettings.values", CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_NONE);
    assert.equal(state.mapGet("remoteCursors.pasteByPlayer", 2), undefined);
});
