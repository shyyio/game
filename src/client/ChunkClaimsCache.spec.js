import {test} from "node:test";
import assert from "node:assert/strict";
import {ChunkClaimsCache} from "@/client/ChunkClaimsCache.js";
import {WelcomeEvent, PlayerDirectoryEvent, FriendListEvent} from "@/common/PlayerEvents.js";
import {ChunkClaimSyncEvent, ChunkClaimUpdateEvent} from "@/common/ClaimEvents.js";
import {PLAYER_ID_NONE} from "@/common/constants.js";

test("welcome and directory fill identity and names", () => {
    const cache = new ChunkClaimsCache();
    cache.onEvent(new WelcomeEvent(3, 12));
    cache.onEvent(new PlayerDirectoryEvent([1, 3], ["alice", "carol"]));
    assert.equal(cache.ownPlayerId, 3);
    assert.equal(cache.maxChunks, 12);
    assert.equal(cache.usernameOf(1), "alice");
    assert.equal(cache.usernameOf(9), "player9", "unknown ids fall back to a synthetic name");
});

test("sync replaces the map and updates apply deltas", () => {
    const cache = new ChunkClaimsCache();
    const touched = [];
    cache.onUpdate(chunks => touched.push([...chunks]));

    cache.onEvent(new ChunkClaimSyncEvent([100, 101], [1, 2]));
    assert.deepEqual(touched.at(-1).sort(), [100, 101]);
    assert.equal(cache.ownerOf(100), 1);

    cache.onEvent(new ChunkClaimUpdateEvent(102, 2));
    assert.equal(cache.ownerOf(102), 2);
    assert.deepEqual(touched.at(-1), [102]);

    cache.onEvent(new ChunkClaimUpdateEvent(100, PLAYER_ID_NONE));
    assert.equal(cache.ownerOf(100), PLAYER_ID_NONE);

    // A resync touches evicted chunks too, so stale borders drop.
    cache.onEvent(new ChunkClaimSyncEvent([101], [2]));
    assert.ok(touched.at(-1).includes(102));
});

test("own count and friends", () => {
    const cache = new ChunkClaimsCache();
    cache.onEvent(new WelcomeEvent(1, 9));
    cache.onEvent(new ChunkClaimSyncEvent([100, 101, 102], [1, 1, 2]));
    assert.equal(cache.ownCount(), 2);
    cache.onEvent(new FriendListEvent([2]));
    assert.equal(cache.isFriend(2), true);
    assert.equal(cache.isFriend(3), false);
});
