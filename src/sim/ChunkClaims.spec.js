import {test} from "node:test";
import assert from "node:assert/strict";
import {ChunkClaims} from "@/sim/ChunkClaims.js";
import {ClaimResult} from "@/common/ClaimEvents.js";
import {chunkOrdinal} from "@/common/util.js";
import {PLAYER_ID_NONE} from "@/common/constants.js";

const MAX = 9;

test("first claim lands anywhere", () => {
    const claims = new ChunkClaims();
    assert.equal(claims.claim(1, chunkOrdinal(30, -20), MAX), ClaimResult.CLAIM_RESULT_OK);
    assert.equal(claims.ownerOf(chunkOrdinal(30, -20)), 1);
    assert.equal(claims.countOf(1), 1);
});

test("the null player cannot claim", () => {
    const claims = new ChunkClaims();
    assert.throws(() => claims.claim(PLAYER_ID_NONE, chunkOrdinal(0, 0), MAX), RangeError);
});

test("a second claim must touch an own chunk edge-on", () => {
    const claims = new ChunkClaims();
    claims.claim(1, chunkOrdinal(0, 0), MAX);
    assert.equal(claims.claim(1, chunkOrdinal(2, 0), MAX), ClaimResult.CLAIM_RESULT_NOT_ADJACENT);
    assert.equal(claims.claim(1, chunkOrdinal(1, 1), MAX), ClaimResult.CLAIM_RESULT_NOT_ADJACENT, "diagonal is not adjacent");
    assert.equal(claims.claim(1, chunkOrdinal(1, 0), MAX), ClaimResult.CLAIM_RESULT_OK);
    assert.equal(claims.claim(1, chunkOrdinal(1, 1), MAX), ClaimResult.CLAIM_RESULT_OK, "now edge-adjacent");
});

test("a claimed chunk cannot be claimed again", () => {
    const claims = new ChunkClaims();
    claims.claim(1, chunkOrdinal(0, 0), MAX);
    assert.equal(claims.claim(2, chunkOrdinal(0, 0), MAX), ClaimResult.CLAIM_RESULT_OWNED);
    assert.equal(claims.claim(1, chunkOrdinal(0, 0), MAX), ClaimResult.CLAIM_RESULT_OWNED);
});

test("the claim limit is enforced", () => {
    const claims = new ChunkClaims();
    assert.equal(claims.claim(1, chunkOrdinal(0, 0), 2), ClaimResult.CLAIM_RESULT_OK);
    assert.equal(claims.claim(1, chunkOrdinal(1, 0), 2), ClaimResult.CLAIM_RESULT_OK);
    assert.equal(claims.claim(1, chunkOrdinal(2, 0), 2), ClaimResult.CLAIM_RESULT_LIMIT);
});

test("only the owner may unclaim", () => {
    const claims = new ChunkClaims();
    claims.claim(1, chunkOrdinal(0, 0), MAX);
    assert.equal(claims.unclaim(2, chunkOrdinal(0, 0)), ClaimResult.CLAIM_RESULT_NOT_OWNER);
    assert.equal(claims.unclaim(1, chunkOrdinal(5, 5)), ClaimResult.CLAIM_RESULT_NOT_OWNER);
    assert.equal(claims.unclaim(1, chunkOrdinal(0, 0)), ClaimResult.CLAIM_RESULT_OK);
    assert.equal(claims.ownerOf(chunkOrdinal(0, 0)), PLAYER_ID_NONE);
});

test("unclaiming the middle of a line would split it", () => {
    const claims = new ChunkClaims();
    claims.claim(1, chunkOrdinal(0, 0), MAX);
    claims.claim(1, chunkOrdinal(1, 0), MAX);
    claims.claim(1, chunkOrdinal(2, 0), MAX);
    assert.equal(claims.unclaim(1, chunkOrdinal(1, 0)), ClaimResult.CLAIM_RESULT_WOULD_SPLIT);
    assert.equal(claims.unclaim(1, chunkOrdinal(2, 0)), ClaimResult.CLAIM_RESULT_OK, "a leaf detaches cleanly");
    assert.equal(claims.unclaim(1, chunkOrdinal(1, 0)), ClaimResult.CLAIM_RESULT_OK, "now itself a leaf");
});

test("unclaiming a ring chunk keeps the ring connected", () => {
    const claims = new ChunkClaims();
    // A 3x3 ring around the (1,1) hole.
    const ring = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
    for (const [x, y] of ring) {
        assert.equal(claims.claim(1, chunkOrdinal(x, y), 8), ClaimResult.CLAIM_RESULT_OK);
    }
    assert.equal(claims.unclaim(1, chunkOrdinal(2, 1)), ClaimResult.CLAIM_RESULT_OK);
});

test("claims clip to the region edge", () => {
    const claims = new ChunkClaims();
    // Top-left corner of the region: only two in-region neighbors exist.
    claims.claim(1, chunkOrdinal(-64, -64), MAX);
    assert.equal(claims.claim(1, chunkOrdinal(-63, -64), MAX), ClaimResult.CLAIM_RESULT_OK);
});

test("claimsIn filters claims to the rect", () => {
    const claims = new ChunkClaims();
    claims.claim(1, chunkOrdinal(0, 0), MAX);
    claims.claim(1, chunkOrdinal(1, 0), MAX);
    claims.claim(2, chunkOrdinal(10, 10), MAX);

    const inRect = claims.claimsIn(0, 0, 2, 1);
    assert.deepEqual(inRect.chunks.sort(), [chunkOrdinal(0, 0), chunkOrdinal(1, 0)].sort());
    assert.deepEqual(inRect.playerIds, [1, 1]);

    const empty = claims.claimsIn(-5, -5, 3, 3);
    assert.deepEqual(empty.chunks, []);
});

test("table round-trip", () => {
    const claims = new ChunkClaims();
    claims.claim(1, chunkOrdinal(0, 0), MAX);
    claims.claim(1, chunkOrdinal(1, 0), MAX);
    claims.claim(2, chunkOrdinal(10, 10), MAX);

    const restored = new ChunkClaims();
    restored.deserializeRecords(claims.serializeRecords());
    assert.equal(restored.ownerOf(chunkOrdinal(0, 0)), 1);
    assert.equal(restored.ownerOf(chunkOrdinal(10, 10)), 2);
    assert.equal(restored.countOf(1), 2);
    // Contiguity survives the round-trip: an adjacent claim still works.
    assert.equal(restored.claim(1, chunkOrdinal(2, 0), MAX), ClaimResult.CLAIM_RESULT_OK);

    restored.deserializeRecords(undefined);
    assert.equal(restored.countOf(1), 0);
});
