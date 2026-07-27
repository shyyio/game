import {test} from "node:test";
import assert from "node:assert/strict";

import {OverworldCache, OverworldRect} from "@/client/OverworldCache.js";
import {OverworldSnapshotEvent} from "@/common/OverworldEvents.js";
import {chunkOrdinal} from "@/common/util.js";

const TTL_MS = 30_000;

function snapshotWithOneChunk(rect, chunkX, chunkY) {
    const event = new OverworldSnapshotEvent(rect.chunkX, rect.chunkY, rect.chunkWidth, rect.chunkHeight);
    event.addChunk(chunkOrdinal(chunkX, chunkY), [131], [2], [9]);
    return event;
}

test("a write stores listed runs and cached emptiness for the rest of the rect", () => {
    const cache = new OverworldCache();
    const rect = new OverworldRect(0, 0, 2, 2);
    cache.write(snapshotWithOneChunk(rect, 0, 0), 1000);

    const listed = cache.entry(chunkOrdinal(0, 0));
    assert.deepEqual(listed.runStarts, [131]);
    assert.deepEqual(listed.runLengths, [2]);
    assert.deepEqual(listed.runTypeIds, [9]);

    const empty = cache.entry(chunkOrdinal(1, 1));
    assert.deepEqual(empty.runStarts, []);
    assert.equal(empty.receivedAt, 1000);
});

test("needsFetch is false right after a write, true past the TTL and for uncovered rects", () => {
    const cache = new OverworldCache();
    const rect = new OverworldRect(0, 0, 2, 2);
    cache.write(snapshotWithOneChunk(rect, 0, 0), 1000);

    assert.equal(cache.needsFetch(rect, 1000, TTL_MS), false);
    assert.equal(cache.needsFetch(rect, 1000 + TTL_MS + 1, TTL_MS), true);
    assert.equal(cache.needsFetch(new OverworldRect(0, 0, 3, 2), 1000, TTL_MS), true);
});

test("evictOutside drops only stale entries outside the rect", () => {
    const cache = new OverworldCache();
    cache.write(snapshotWithOneChunk(new OverworldRect(0, 0, 1, 1), 0, 0), 1000);
    cache.write(snapshotWithOneChunk(new OverworldRect(5, 5, 1, 1), 5, 5), 2000);

    // Still fresh: the out-of-rect entry survives.
    cache.evictOutside(new OverworldRect(5, 5, 1, 1), 2000, TTL_MS);
    assert.notEqual(cache.entry(chunkOrdinal(0, 0)), undefined);

    // Past its TTL: gone; the in-rect entry stays despite its age.
    cache.evictOutside(new OverworldRect(5, 5, 1, 1), 2000 + TTL_MS, TTL_MS);
    assert.equal(cache.entry(chunkOrdinal(0, 0)), undefined);
    assert.notEqual(cache.entry(chunkOrdinal(5, 5)), undefined);
});

test("writes and evictions notify update listeners with the touched chunks", () => {
    const cache = new OverworldCache();
    const updates = [];
    cache.onUpdate(chunks => updates.push(chunks));

    const rect = new OverworldRect(0, 0, 2, 1);
    cache.write(snapshotWithOneChunk(rect, 0, 0), 1000);
    assert.deepEqual(updates, [[chunkOrdinal(0, 0), chunkOrdinal(1, 0)]]);

    cache.evictOutside(new OverworldRect(5, 5, 1, 1), 1000 + TTL_MS + 1, TTL_MS);
    assert.equal(updates.length, 2);
    assert.deepEqual([...updates[1]].sort((a, b) => a - b), [chunkOrdinal(0, 0), chunkOrdinal(1, 0)]);
});
