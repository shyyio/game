import {test} from "node:test";
import assert from "node:assert/strict";
import {ClientCache} from "@/client/ClientCache.js";
import {CHUNK_CLAIMS_SCHEMA, ChunkClaimsWriter, ChunkClaimsView} from "@/client/ChunkClaimsState.js";
import {WelcomeEvent, PlayerDirectoryEvent, FriendListEvent} from "@/common/PlayerEvents.js";
import {ChunkClaimSyncEvent, ChunkClaimUpdateEvent} from "@/common/ClaimEvents.js";
import {PLAYER_ID_NONE} from "@/common/constants.js";

function claimsState() {
    const state = new ClientCache();
    state.register("chunkClaims", CHUNK_CLAIMS_SCHEMA, new ChunkClaimsWriter(state), new ChunkClaimsView());
    return {state, claims: state.view("chunkClaims")};
}

test("welcome and directory fill identity and names", () => {
    const {state, claims} = claimsState();
    state.onEvent(new WelcomeEvent(3, 12));
    state.onEvent(new PlayerDirectoryEvent([1, 3], ["alice", "carol"]));
    assert.equal(claims.ownPlayerId, 3);
    assert.equal(claims.maxChunks, 12);
    assert.equal(claims.usernameOf(1), "alice");
    assert.equal(claims.usernameOf(9), "player9", "unknown ids fall back to a synthetic name");
});

test("sync replaces the map and updates apply deltas", () => {
    const {state, claims} = claimsState();
    const touched = [];
    state.subscribe("chunkClaims.ownerByChunk", (chunk, owner) => touched.push([chunk, owner]));

    state.onEvent(new ChunkClaimSyncEvent([100, 101], [1, 2]));
    assert.equal(claims.ownerOf(100), 1);

    state.onEvent(new ChunkClaimUpdateEvent(102, 2));
    assert.equal(claims.ownerOf(102), 2);
    assert.deepEqual(touched.at(-1), [102, 2]);

    state.onEvent(new ChunkClaimUpdateEvent(100, PLAYER_ID_NONE));
    assert.equal(claims.ownerOf(100), PLAYER_ID_NONE);
    assert.deepEqual(touched.at(-1), [100, undefined]);

    // A resync deletes evicted chunks, so stale borders drop.
    state.onEvent(new ChunkClaimSyncEvent([101], [2]));
    assert.ok(touched.some(([chunk, owner]) => chunk === 102 && owner === undefined));
});

test("own count and friends", () => {
    const {state, claims} = claimsState();
    state.onEvent(new WelcomeEvent(1, 9));
    state.onEvent(new ChunkClaimSyncEvent([100, 101, 102], [1, 1, 2]));
    assert.equal(claims.ownCount(), 2);
    state.onEvent(new FriendListEvent([2]));
    assert.equal(claims.isFriend(2), true);
    assert.equal(claims.isFriend(3), false);
});
