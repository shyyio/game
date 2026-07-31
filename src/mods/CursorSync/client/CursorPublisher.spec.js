import {test} from "node:test";
import assert from "node:assert/strict";
import {CursorPublisher} from "./CursorPublisher.js";
import {CursorMoveMessage, CursorHideMessage} from "../common/messages.js";
import {CURSOR_SETTING_SHARE, CURSOR_AUDIENCE_NONE, CURSOR_AUDIENCE_FRIENDS, CURSOR_AUDIENCE_EVERYONE} from "../common/constants.js";
import {ClientCache} from "@/client/ClientCache.js";
import {PLAYER_SETTINGS_SCHEMA, PlayerSettingsWriter, PlayerSettingsView} from "@/client/SettingsState.js";
import {TILE_SIZE, ViewMode} from "@/client/constants.js";

class FakeWindowFocus {

    constructor() {
        this.focused = true;
        this._listeners = [];
    }

    onChange(callback) {
        this._listeners.push(callback);
    }

    set(focused) {
        this.focused = focused;
        for (const callback of this._listeners) {
            callback(focused);
        }
    }
}

function publisher() {
    const sent = [];
    const session = {sendMessage: message => sent.push(message)};
    const mouse = {currentX: null, currentY: null};
    const state = new ClientCache();
    state.register("playerSettings", PLAYER_SETTINGS_SCHEMA, new PlayerSettingsWriter(state), new PlayerSettingsView());
    const focus = new FakeWindowFocus();
    return {sent, mouse, state, focus, publisher: new CursorPublisher(session, mouse, state, focus)};
}

test("sends a heartbeat only while the cursor moves", () => {
    const {sent, mouse, publisher: pub} = publisher();
    pub.tick();
    assert.equal(sent.length, 0, "no position yet, nothing sent");

    mouse.currentX = 3 * TILE_SIZE;
    mouse.currentY = -2 * TILE_SIZE;
    pub.tick();
    assert.equal(sent.length, 1);
    assert.ok(sent[0] instanceof CursorMoveMessage);
    assert.equal(sent[0].x, 3);
    assert.equal(sent[0].y, -2);

    pub.tick();
    assert.equal(sent.length, 1, "resting cursor sends nothing");

    mouse.currentX += TILE_SIZE / 2;
    pub.tick();
    assert.equal(sent.length, 2);
    assert.equal(sent[1].x, 3.5);
});

test("blur hides once and refocus re-shows on the next heartbeat", () => {
    const {sent, mouse, focus, publisher: pub} = publisher();
    mouse.currentX = 0;
    mouse.currentY = 0;
    pub.tick();
    assert.equal(sent.length, 1);

    focus.set(false);
    assert.equal(sent.length, 2);
    assert.ok(sent[1] instanceof CursorHideMessage);
    focus.set(false);
    pub.tick();
    assert.equal(sent.length, 2, "no repeat hide, no heartbeat while blurred");

    focus.set(true);
    pub.tick();
    assert.equal(sent.length, 3, "re-shows without requiring movement");
    assert.ok(sent[2] instanceof CursorMoveMessage);
});

test("leaving world mode hides; a hide before any heartbeat sends nothing", () => {
    const {sent, mouse, publisher: pub} = publisher();
    pub.setViewMode(ViewMode.MAP);
    assert.equal(sent.length, 0, "never shown, nothing to hide");

    pub.setViewMode(ViewMode.WORLD);
    mouse.currentX = TILE_SIZE;
    mouse.currentY = TILE_SIZE;
    pub.tick();
    pub.setViewMode(ViewMode.OVERWORLD);
    assert.equal(sent.length, 2);
    assert.ok(sent[1] instanceof CursorHideMessage);
    pub.tick();
    assert.equal(sent.length, 2, "no heartbeat outside world mode");
});

test("sharing with no one gates heartbeats without a wire hide; re-sharing resumes", () => {
    const {sent, mouse, state, publisher: pub} = publisher();
    mouse.currentX = 0;
    mouse.currentY = 0;
    pub.tick();
    state.mapSet("playerSettings.values", CURSOR_SETTING_SHARE, CURSOR_AUDIENCE_NONE);
    pub.tick();
    assert.equal(sent.length, 1, "the server erases on the setting write; no client hide");

    state.mapSet("playerSettings.values", CURSOR_SETTING_SHARE, CURSOR_AUDIENCE_EVERYONE);
    pub.tick();
    assert.equal(sent.length, 2);
    assert.ok(sent[1] instanceof CursorMoveMessage);
});

test("narrowing sharing to friends re-sends the resting cursor on the next heartbeat", () => {
    const {sent, mouse, state, publisher: pub} = publisher();
    mouse.currentX = 0;
    mouse.currentY = 0;
    pub.tick();
    state.mapSet("playerSettings.values", CURSOR_SETTING_SHARE, CURSOR_AUDIENCE_FRIENDS);
    pub.tick();
    assert.equal(sent.length, 2, "the server-erased cursor re-shows for friends");
    assert.ok(sent[1] instanceof CursorMoveMessage);
});
