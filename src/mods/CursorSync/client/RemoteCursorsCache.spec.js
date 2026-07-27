import {test} from "node:test";
import assert from "node:assert/strict";
import {RemoteCursorsCache} from "./RemoteCursorsCache.js";
import {PlayerCursorEvent, PlayerCursorHideEvent} from "../common/events.js";
import {CURSOR_SETTING_SHOW} from "../common/constants.js";
import {WelcomeEvent} from "@/common/PlayerEvents.js";
import {ChunkUnsubscribeEvent} from "@/common/CoreEvents.js";
import {ChunkClaimsCache} from "@/client/ChunkClaimsCache.js";
import {PlayerSettings} from "@/client/PlayerSettings.js";
import {SETTING_ON, SETTING_OFF} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";

function cacheWithOwnPlayer(ownPlayerId) {
    const claims = new ChunkClaimsCache();
    claims.onEvent(new WelcomeEvent(ownPlayerId, 9));
    const settings = new PlayerSettings();
    const cache = new RemoteCursorsCache(claims, settings);
    const upserts = [];
    const removes = [];
    cache.onUpsert(cursor => upserts.push(cursor));
    cache.onRemove(playerId => removes.push(playerId));
    return {cache, settings, upserts, removes};
}

test("upserts a cursor per event and mutates it in place", () => {
    const {cache, upserts} = cacheWithOwnPlayer(1);
    assert.equal(cache.onEvent(new PlayerCursorEvent(2, 4.5, -1.25)), true);
    assert.equal(cache.onEvent(new PlayerCursorEvent(2, 5.0, -1.0)), true);
    assert.equal(upserts.length, 2);
    assert.equal(upserts[0], upserts[1], "one cursor object, updated in place");
    assert.equal(upserts[0].playerId, 2);
    assert.equal(upserts[0].x, 5.0);
});

test("drops the own player's echoed events", () => {
    const {cache, upserts} = cacheWithOwnPlayer(1);
    assert.equal(cache.onEvent(new PlayerCursorEvent(1, 0, 0)), true);
    assert.deepEqual(upserts, []);
});

test("a hide event removes its cursor; an unknown player's hide notifies nothing", () => {
    const {cache, removes} = cacheWithOwnPlayer(1);
    cache.onEvent(new PlayerCursorEvent(2, 0, 0));
    assert.equal(cache.onEvent(new PlayerCursorHideEvent(2)), true);
    assert.equal(cache.onEvent(new PlayerCursorHideEvent(9)), true);
    assert.deepEqual(removes, [2]);
});

test("a chunk unsubscribe drops its cursors without being consumed", () => {
    const {cache, removes} = cacheWithOwnPlayer(1);
    cache.onEvent(new PlayerCursorEvent(2, 4.5, -1.25));
    cache.onEvent(new PlayerCursorEvent(3, 200.5, 200.5));
    assert.equal(cache.onEvent(new ChunkUnsubscribeEvent(chunkId(4.5, -1.25))), false);
    assert.deepEqual(removes, [2]);
});

test("the show toggle clears and gates; re-enabling resumes", () => {
    const {cache, settings, upserts, removes} = cacheWithOwnPlayer(1);
    cache.onEvent(new PlayerCursorEvent(2, 0, 0));
    settings.update(CURSOR_SETTING_SHOW, SETTING_OFF);
    assert.deepEqual(removes, [2]);

    assert.equal(cache.onEvent(new PlayerCursorEvent(3, 1, 1)), true);
    assert.equal(upserts.length, 1, "updates are ignored while hidden");

    settings.update(CURSOR_SETTING_SHOW, SETTING_ON);
    cache.onEvent(new PlayerCursorEvent(3, 1, 1));
    assert.equal(upserts.length, 2);
});

test("unrelated events are not consumed", () => {
    const {cache} = cacheWithOwnPlayer(1);
    assert.equal(cache.onEvent(new WelcomeEvent(5, 9)), false);
});
