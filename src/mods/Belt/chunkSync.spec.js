import {test} from "node:test";
import assert from "node:assert";

import {setup} from "@/test/common.js";
import {createBelt} from "./testHelpers.js";
import {BeltSyncEvent, BeltPathRecalculateEvent} from "./events.js";
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
    // One belt sync plus a path-recalc seed for the lone belt's path.
    assert.strictEqual(sync.events.length, 2);

    const seeded = sync.events.find(event => event instanceof BeltSyncEvent);
    assert.ok(seeded, "bundle holds a BeltSyncEvent");
    assert.strictEqual(typeof seeded.id, "bigint");
    assert.strictEqual(seeded.x, 1);
    assert.strictEqual(seeded.y, 1);
    assert.strictEqual(seeded.direction, Direction.UP);
    assert.strictEqual(seeded.beltType, BeltType.NORMAL);
    // Standalone belt has no parent.
    assert.strictEqual(seeded.parentX, null);
    assert.strictEqual(seeded.parentY, null);

    // The belt syncs precede the path seed, so the client has positions before it draws.
    assert.ok(sync.events[0] instanceof BeltSyncEvent, "belt syncs come first");
    const pathSeed = sync.events.find(event => event instanceof BeltPathRecalculateEvent);
    assert.ok(pathSeed, "bundle holds a BeltPathRecalculateEvent");
    assert.deepStrictEqual(pathSeed.parts, [seeded.id]);
});

test("a multi-belt path is seeded as one recalc, head last", async () => {
    const harness = await setup();
    createBelt(harness, BeltType.NORMAL, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(harness, BeltType.NORMAL, {x: 2, y: 1, direction: Direction.RIGHT});
    createBelt(harness, BeltType.NORMAL, {x: 3, y: 1, direction: Direction.RIGHT});

    const events = captureEvents(harness);
    harness.dispatchMessage(new SetViewportMessage([chunkKey(1, 1)]));

    const sync = events.find(event => event instanceof ChunkSyncEvent);
    const pathSeeds = sync.events.filter(event => event instanceof BeltPathRecalculateEvent);
    assert.strictEqual(pathSeeds.length, 1, "one recalc for the single shared path");
    assert.strictEqual(pathSeeds[0].parts.length, 3);
    // parts run head last; the head belt id is the path's id.
    const head = harness.rawScalar("SELECT path_id FROM Belt WHERE x = 1 AND y = 1");
    const seededHead = pathSeeds[0].parts[pathSeeds[0].parts.length - 1];
    assert.strictEqual(Number(seededHead), Number(head));
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
    // One belt sync plus the path-recalc seed for its path.
    assert.strictEqual(resync.events.length, 2);
});
