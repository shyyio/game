import {test} from "node:test";
import assert from "node:assert/strict";

import {ClientCache} from "@/client/ClientCache.js";
import {OVERWORLD_SCHEMA, OverworldRect, OverworldWriter, OverworldView} from "@/client/OverworldState.js";
import {OverworldSnapshotEvent} from "@/common/OverworldEvents.js";
import {chunkOrdinal} from "@/common/util.js";

const TTL_MS = 30_000;

function overworldState() {
    const state = new ClientCache();
    state.register("overworld", OVERWORLD_SCHEMA, new OverworldWriter(state), new OverworldView());
    return {state, writer: state.writer("overworld"), view: state.view("overworld")};
}

function snapshotWithOneChunk(rect, chunkX, chunkY) {
    const event = new OverworldSnapshotEvent(rect.chunkX, rect.chunkY, rect.chunkWidth, rect.chunkHeight);
    event.addChunk(chunkOrdinal(chunkX, chunkY), [131], [2], [9]);
    return event;
}

test("a write stores listed runs and cached emptiness for the rest of the rect", () => {
    const {state, writer} = overworldState();
    const rect = new OverworldRect(0, 0, 2, 2);
    writer.write(snapshotWithOneChunk(rect, 0, 0), 1000);

    const listed = state.mapGet("overworld.byChunk", chunkOrdinal(0, 0));
    assert.deepEqual(listed.runStarts, [131]);
    assert.deepEqual(listed.runLengths, [2]);
    assert.deepEqual(listed.runTypeIds, [9]);

    const empty = state.mapGet("overworld.byChunk", chunkOrdinal(1, 1));
    assert.deepEqual(empty.runStarts, []);
    assert.equal(empty.receivedAt, 1000);
});

test("needsFetch is false right after a write, true past the TTL and for uncovered rects", () => {
    const {writer, view} = overworldState();
    const rect = new OverworldRect(0, 0, 2, 2);
    writer.write(snapshotWithOneChunk(rect, 0, 0), 1000);

    assert.equal(view.needsFetch(rect, 1000, TTL_MS), false);
    assert.equal(view.needsFetch(rect, 1000 + TTL_MS + 1, TTL_MS), true);
    assert.equal(view.needsFetch(new OverworldRect(0, 0, 3, 2), 1000, TTL_MS), true);
});

test("evictOutside drops only stale entries outside the rect", () => {
    const {state, writer} = overworldState();
    writer.write(snapshotWithOneChunk(new OverworldRect(0, 0, 1, 1), 0, 0), 1000);
    writer.write(snapshotWithOneChunk(new OverworldRect(5, 5, 1, 1), 5, 5), 2000);

    // Still fresh: the out-of-rect entry survives.
    writer.evictOutside(new OverworldRect(5, 5, 1, 1), 2000, TTL_MS);
    assert.notEqual(state.mapGet("overworld.byChunk", chunkOrdinal(0, 0)), undefined);

    // Past its TTL: gone; the in-rect entry stays despite its age.
    writer.evictOutside(new OverworldRect(5, 5, 1, 1), 2000 + TTL_MS, TTL_MS);
    assert.equal(state.mapGet("overworld.byChunk", chunkOrdinal(0, 0)), undefined);
    assert.notEqual(state.mapGet("overworld.byChunk", chunkOrdinal(5, 5)), undefined);
});

test("writes and evictions notify subscribers with the touched chunks", () => {
    const {state, writer} = overworldState();
    const updates = [];
    state.subscribe("overworld.byChunk", (chunk, entry) => updates.push([chunk, entry]));

    const rect = new OverworldRect(0, 0, 2, 1);
    writer.write(snapshotWithOneChunk(rect, 0, 0), 1000);
    assert.deepEqual(updates.map(([chunk]) => chunk), [chunkOrdinal(0, 0), chunkOrdinal(1, 0)]);

    writer.evictOutside(new OverworldRect(5, 5, 1, 1), 1000 + TTL_MS + 1, TTL_MS);
    const evicted = updates.slice(2);
    assert.deepEqual(evicted.map(([chunk]) => chunk).sort((a, b) => a - b), [chunkOrdinal(0, 0), chunkOrdinal(1, 0)]);
    assert.ok(evicted.every(([, entry]) => entry === undefined));
});
