import {test} from "node:test";
import assert from "node:assert";

import {setup} from "@/test/common.js";
import {createBelt} from "./testHelpers.js";
import {BeltSyncEvent} from "./events.js";
import {BeltType} from "./constants.js";
import {SetViewportMessage} from "@/common/CoreMessages.js";
import {chunkKey} from "@/common/util.js";
import {Direction} from "@/common/constants.js";
import {ChunkSyncEvent, ChunkUnsubscribeEvent} from "@/common/CoreEvents.js";

/**
 * Captures the events the game pushes to the session — the harness leaves
 * session.client null, so a stub stands in for the browser client.
 */
function captureEvents(harness) {
    const events = [];
    harness.session.client = {publishEvent: event => events.push(event)};
    return events;
}

test("subscribing a chunk seeds the client with belts already in it", async () => {
    const harness = await setup();
    // Belt placed before the chunk is ever viewed: no viewport, so nothing is
    // pushed live — it must be delivered later by the chunk-sync bundle.
    createBelt(harness, BeltType.NORMAL, {x: 1, y: 1, direction: Direction.UP});

    const events = captureEvents(harness);
    harness.dispatchMessage(new SetViewportMessage([chunkKey(1, 1)]));

    const sync = events.find(event => event instanceof ChunkSyncEvent);
    assert.ok(sync, "expected a ChunkSyncEvent");
    assert.strictEqual(sync.events.length, 1);

    const seeded = sync.events[0];
    assert.ok(seeded instanceof BeltSyncEvent, "bundle holds a BeltSyncEvent");
    assert.strictEqual(typeof seeded.id, "bigint");
    assert.strictEqual(seeded.x, 1);
    assert.strictEqual(seeded.y, 1);
    assert.strictEqual(seeded.direction, Direction.UP);
    assert.strictEqual(seeded.beltType, BeltType.NORMAL);
    // Standalone belt has no parent.
    assert.strictEqual(seeded.parentX, null);
    assert.strictEqual(seeded.parentY, null);
});

test("an empty chunk seeds nothing", async () => {
    const harness = await setup();
    const events = captureEvents(harness);
    harness.dispatchMessage(new SetViewportMessage([chunkKey(1, 1)]));

    assert.ok(!events.some(event => event instanceof ChunkSyncEvent));
});

test("leaving a chunk unsubscribes it; re-entering re-syncs only the delta", async () => {
    const harness = await setup();
    createBelt(harness, BeltType.NORMAL, {x: 1, y: 1, direction: Direction.UP});

    const events = captureEvents(harness);
    harness.dispatchMessage(new SetViewportMessage([chunkKey(1, 1)]));
    events.length = 0;

    // Pan away: the chunk leaves the viewport.
    harness.dispatchMessage(new SetViewportMessage([chunkKey(500, 500)]));
    const unsubscribe = events.find(event =>
        event instanceof ChunkUnsubscribeEvent
        && event.chunk === chunkKey(1, 1));
    assert.ok(unsubscribe, "expected a chunk-unsubscribe for the chunk left behind");
    // The empty chunk we panned into seeds nothing.
    assert.ok(!events.some(event => event instanceof ChunkSyncEvent));

    // Pan back: only the re-entered chunk is synced again.
    events.length = 0;
    harness.dispatchMessage(new SetViewportMessage([chunkKey(1, 1)]));
    const resync = events.find(event => event instanceof ChunkSyncEvent);
    assert.ok(resync, "expected a re-sync when the chunk re-enters the viewport");
    assert.strictEqual(resync.events.length, 1);
});
