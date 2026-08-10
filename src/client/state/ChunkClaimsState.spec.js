import {test} from "node:test";
import assert from "node:assert/strict";
import {ClientCache} from "@/client/state/ClientCache.js";
import {CHUNK_CLAIMS_SCHEMA, ChunkClaimsWriter, ChunkClaimsView} from "@/client/state/ChunkClaimsState.js";
import {WelcomeEvent, FriendListEvent} from "@/common/PlayerEvents.js";
import {OwnClaimsSyncEvent, ChunkClaimUpdateEvent, ClaimResult, ChunkPermission} from "@/common/ClaimEvents.js";
import {ChunkSubscribeEvent} from "@/common/CoreEvents.js";
import {OverworldSnapshotEvent} from "@/common/OverworldEvents.js";
import {PLAYER_ID_NONE} from "@/common/constants.js";
import {chunkOrdinal} from "@/common/util.js";

function claimsState() {
    const state = new ClientCache();
    state.register("chunkClaims", CHUNK_CLAIMS_SCHEMA, new ChunkClaimsWriter(state), new ChunkClaimsView());
    return {state, claims: state.view("chunkClaims")};
}

test("welcome fills identity", () => {
    const {state, claims} = claimsState();
    state.onEvent(new WelcomeEvent(3, 12, "0001-2A3B"));
    assert.equal(claims.ownPlayerId, 3);
    assert.equal(claims.maxChunks, 12);
    assert.equal(claims.ownFriendCode, "0001-2A3B");
});

test("own-claims sync fills the own set, the ownership mirror, and the permission mirror", () => {
    const {state, claims} = claimsState();
    state.onEvent(new WelcomeEvent(1, 9, "0001-2A3B"));
    state.onEvent(new OwnClaimsSyncEvent(
        [100, 101],
        [ChunkPermission.PERMISSION_FRIENDS, ChunkPermission.PERMISSION_ONLY_ME],
    ));
    assert.deepEqual(claims.ownChunks().sort(), [100, 101]);
    assert.equal(claims.ownCount(), 2);
    assert.equal(claims.ownerOf(100), 1);
    assert.equal(claims.permissionOf(100), ChunkPermission.PERMISSION_FRIENDS);
    assert.equal(claims.permissionOf(101), ChunkPermission.PERMISSION_ONLY_ME);
});

test("updates apply deltas to the mirror and the own set", () => {
    const {state, claims} = claimsState();
    state.onEvent(new WelcomeEvent(1, 9, "0001-2A3B"));
    const touched = [];
    state.subscribe("chunkClaims.ownerByChunk", (chunk, owner) => touched.push([chunk, owner]));

    state.onEvent(new ChunkClaimUpdateEvent(102, 2));
    assert.equal(claims.ownerOf(102), 2);
    assert.equal(claims.ownCount(), 0, "a foreign claim stays out of the own set");
    assert.deepEqual(touched.at(-1), [102, 2]);

    state.onEvent(new ChunkClaimUpdateEvent(100, 1));
    assert.deepEqual(claims.ownChunks(), [100], "an own claim joins the own set");

    state.onEvent(new ChunkClaimUpdateEvent(100, PLAYER_ID_NONE));
    assert.equal(claims.ownerOf(100), PLAYER_ID_NONE);
    assert.equal(claims.ownCount(), 0, "an unclaim leaves the own set");
    assert.deepEqual(touched.at(-1), [100, undefined]);
});

test("a chunk subscribe resets a stale foreign entry ahead of the seeded update", () => {
    const {state, claims} = claimsState();
    state.onEvent(new WelcomeEvent(1, 9, "0001-2A3B"));
    state.onEvent(new ChunkClaimUpdateEvent(100, 1));
    state.onEvent(new ChunkClaimUpdateEvent(101, 2));

    state.onEvent(new ChunkSubscribeEvent(101));
    assert.equal(claims.ownerOf(101), PLAYER_ID_NONE, "no seed follows an unclaimed chunk");

    state.onEvent(new ChunkSubscribeEvent(100));
    assert.equal(claims.ownerOf(100), 1, "own claim survives");
});

test("an overworld snapshot stamps its rect's claims and sheds stale foreign entries", () => {
    const {state, claims} = claimsState();
    state.onEvent(new WelcomeEvent(1, 9, "0001-2A3B"));
    const inRect = chunkOrdinal(0, 0);
    const staleInRect = chunkOrdinal(1, 0);
    const ownInRect = chunkOrdinal(0, 1);
    const outsideRect = chunkOrdinal(5, 5);
    state.onEvent(new ChunkClaimUpdateEvent(staleInRect, 3));
    state.onEvent(new ChunkClaimUpdateEvent(ownInRect, 1));
    state.onEvent(new ChunkClaimUpdateEvent(outsideRect, 4));

    const event = new OverworldSnapshotEvent(0, 0, 2, 2);
    event.claimedChunks = [inRect];
    event.claimOwners = [2];
    state.onEvent(event);

    assert.equal(claims.ownerOf(inRect), 2, "rect claim stamped");
    assert.equal(claims.ownerOf(staleInRect), PLAYER_ID_NONE, "stale foreign entry in the rect shed");
    assert.equal(claims.ownerOf(ownInRect), 1, "own claim survives the stamp");
    assert.equal(claims.ownerOf(outsideRect), 4, "entries outside the rect untouched");
});

test("canBuildIn mirrors the sim gate", () => {
    const {state, claims} = claimsState();
    state.onEvent(new WelcomeEvent(1, 9, "0001-2A3B"));
    state.onEvent(new OwnClaimsSyncEvent([100], [ChunkPermission.PERMISSION_FRIENDS]));
    state.onEvent(new ChunkClaimUpdateEvent(101, 2, ChunkPermission.PERMISSION_FRIENDS));
    assert.equal(claims.canBuildIn(100), true, "own chunk");
    assert.equal(claims.canBuildIn(101), false, "stranger's chunk");
    assert.equal(claims.canBuildIn(102), false, "unclaimed chunk");

    state.onEvent(new FriendListEvent([2], []));
    assert.equal(claims.canBuildIn(101), false, "own grant to the owner gives nothing back");

    state.onEvent(new FriendListEvent([2], [2]));
    assert.equal(claims.canBuildIn(101), true, "owner's grant unlocks their chunk");

    state.onEvent(new ChunkClaimUpdateEvent(101, PLAYER_ID_NONE));
    assert.equal(claims.canBuildIn(101), false, "unclaimed again");
});

test("canBuildIn's only-me permission blocks even a grant", () => {
    const {state, claims} = claimsState();
    state.onEvent(new WelcomeEvent(1, 9, "0001-2A3B"));

    state.onEvent(new ChunkClaimUpdateEvent(201, 2, ChunkPermission.PERMISSION_ONLY_ME));
    assert.equal(claims.canBuildIn(201), false, "only-me blocks a non-owner outright");
    state.onEvent(new FriendListEvent([], [2]));
    assert.equal(claims.canBuildIn(201), false, "only-me still blocks once granted");
});

test("claimCheck mirrors the sim's claim rules", () => {
    const {state, claims} = claimsState();
    state.onEvent(new WelcomeEvent(1, 2, "0001-2A3B"));
    assert.equal(claims.claimCheck(500), ClaimResult.CLAIM_RESULT_OK, "first claim goes anywhere");

    state.onEvent(new OwnClaimsSyncEvent([100], [ChunkPermission.PERMISSION_FRIENDS]));
    assert.equal(claims.claimCheck(100), ClaimResult.CLAIM_RESULT_OWNED);
    assert.equal(claims.claimCheck(101), ClaimResult.CLAIM_RESULT_OK, "edge neighbor of own");
    assert.equal(claims.claimCheck(105), ClaimResult.CLAIM_RESULT_NOT_ADJACENT);

    state.onEvent(new ChunkClaimUpdateEvent(101, 1));
    assert.equal(claims.claimCheck(102), ClaimResult.CLAIM_RESULT_LIMIT, "at maxChunks");
});

test("friends", () => {
    const {state, claims} = claimsState();
    state.onEvent(new WelcomeEvent(1, 9, "0001-2A3B"));
    state.onEvent(new FriendListEvent([2], [3]));
    assert.equal(claims.isFriend(2), true);
    assert.equal(claims.isFriend(3), false);
    assert.equal(claims.isFriendsWithMe(3), true);
    assert.equal(claims.isFriendsWithMe(2), false);
    assert.deepEqual(claims.friendIds(), [2]);
});

test("nearbyForeignOwners orders by distance and dedupes a multi-chunk owner", () => {
    const {state, claims} = claimsState();
    state.onEvent(new WelcomeEvent(1, 9, "0001-2A3B"));
    const near = chunkOrdinal(1, 0);
    const far = chunkOrdinal(5, 0);
    // Player 2 also owns a second, farther chunk; their nearest one still decides their ranking.
    const fartherStillOfNearOwner = chunkOrdinal(9, 0);
    state.onEvent(new ChunkClaimUpdateEvent(near, 2));
    state.onEvent(new ChunkClaimUpdateEvent(far, 3));
    state.onEvent(new ChunkClaimUpdateEvent(fartherStillOfNearOwner, 2));

    const result = claims.nearbyForeignOwners([near, far, fartherStillOfNearOwner], 0, 0);
    assert.deepEqual(result, [2, 3], "closer owner first, deduped to one entry per owner");
});

test("nearbyForeignOwners skips unclaimed chunks, the own player, and friends", () => {
    const {state, claims} = claimsState();
    state.onEvent(new WelcomeEvent(1, 9, "0001-2A3B"));
    state.onEvent(new OwnClaimsSyncEvent([chunkOrdinal(0, 0)], [ChunkPermission.PERMISSION_FRIENDS]));
    state.onEvent(new ChunkClaimUpdateEvent(chunkOrdinal(1, 0), 2));
    state.onEvent(new FriendListEvent([2], []));

    const result = claims.nearbyForeignOwners([chunkOrdinal(0, 0), chunkOrdinal(1, 0), chunkOrdinal(2, 0)], 0, 0);
    assert.deepEqual(result, [], "own chunk, friend's chunk, and unclaimed chunk all excluded");
});
