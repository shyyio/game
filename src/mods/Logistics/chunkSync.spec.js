import {test} from "node:test";
import assert from "node:assert";

import {setup} from "@/test/common.js";
import {createBelt, deleteBelt} from "./testHelpers.js";
import {BeltSyncEvent, BeltPathRecalculateEvent} from "./events.js";
import {BeltType, BUFFERED_EVENT_TYPE_ITEM_RESET, BUFFERED_EVENT_TYPE_ITEM_SYNC} from "./constants.js";
import {SetViewportMessage} from "@/common/CoreMessages.js";
import {chunkId} from "@/common/util.js";
import {Direction} from "@/common/constants.js";
import {ChunkSyncEvent, ChunkUnsubscribeEvent} from "@/common/CoreEvents.js";
import {BufferedEvent} from "@/common/BufferedEvent.js";

/**
 * Captures the events the game pushes to the session — the harness leaves
 * session.client null, so a stub stands in for the browser client.
 */
function captureEvents(harness) {
    const events = [];
    harness.session.client = {publishEvent: event => events.push(event)};
    return events;
}

test("subscribing a chunk syncs the client with belts already in it", async () => {
    const harness = await setup();
    // Belt placed before the chunk is ever viewed: no viewport, so nothing is
    // pushed live — it must be delivered later by the chunk-sync bundle.
    createBelt(harness, BeltType.NORMAL, {x: 1, y: 1, direction: Direction.UP});

    const events = captureEvents(harness);
    harness.dispatchMessage(new SetViewportMessage([chunkId(1, 1)]));

    const sync = events.find(event => event instanceof ChunkSyncEvent);
    assert.ok(sync, "expected a ChunkSyncEvent");
    // One belt sync plus a path-recalc sync for the lone belt's path.
    assert.strictEqual(sync.events.length, 2);

    const synced = sync.events.find(event => event instanceof BeltSyncEvent);
    assert.ok(synced, "bundle holds a BeltSyncEvent");
    assert.strictEqual(typeof synced.id, "bigint");
    assert.strictEqual(synced.x, 1);
    assert.strictEqual(synced.y, 1);
    assert.strictEqual(synced.direction, Direction.UP);
    assert.strictEqual(synced.beltType, BeltType.NORMAL);

    // The belt syncs precede the path sync, so the client has positions before it draws.
    assert.ok(sync.events[0] instanceof BeltSyncEvent, "belt syncs come first");
    const pathSync = sync.events.find(event => event instanceof BeltPathRecalculateEvent);
    assert.ok(pathSync, "bundle holds a BeltPathRecalculateEvent");
    assert.deepStrictEqual(pathSync.parts, [synced.id]);
});

test("a multi-belt path is synced as one recalc, head last", async () => {
    const harness = await setup();
    createBelt(harness, BeltType.NORMAL, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(harness, BeltType.NORMAL, {x: 2, y: 1, direction: Direction.RIGHT});
    createBelt(harness, BeltType.NORMAL, {x: 3, y: 1, direction: Direction.RIGHT});

    const events = captureEvents(harness);
    harness.dispatchMessage(new SetViewportMessage([chunkId(1, 1)]));

    const sync = events.find(event => event instanceof ChunkSyncEvent);
    const pathSyncs = sync.events.filter(event => event instanceof BeltPathRecalculateEvent);
    assert.strictEqual(pathSyncs.length, 1, "one recalc for the single shared path");
    assert.strictEqual(pathSyncs[0].parts.length, 3);
    // parts run head last; the head belt id is the path's id.
    const head = harness.rawScalar("SELECT path_id FROM Belt WHERE x = 1 AND y = 1");
    const syncedHead = pathSyncs[0].parts[pathSyncs[0].parts.length - 1];
    assert.strictEqual(Number(syncedHead), Number(head));
});

test("deleting a path's head publishes a recalc for the re-headed survivor", async () => {
    const harness = await setup();
    createBelt(harness, BeltType.NORMAL, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(harness, BeltType.NORMAL, {x: 2, y: 1, direction: Direction.RIGHT});
    createBelt(harness, BeltType.NORMAL, {x: 3, y: 1, direction: Direction.RIGHT});
    harness.dispatchMessage(new SetViewportMessage([chunkId(1, 1)]));

    // The head belt is the path's id (its upstream-most belt).
    const oldHead = harness.rawScalar("SELECT path_id FROM Belt WHERE x = 1 AND y = 1");

    const events = captureEvents(harness);
    deleteBelt(harness, BigInt(oldHead));

    // The survivors re-head onto a new path, which must be announced or a client
    // tracking paths (e.g. the debug overlay) never learns the new head.
    const newHead = harness.rawScalar("SELECT path_id FROM Belt WHERE x = 2 AND y = 1");
    const recalc = events.find(event =>
        event instanceof BeltPathRecalculateEvent
        && Number(event.parts[event.parts.length - 1]) === Number(newHead));
    assert.ok(recalc, "expected a recalc for the re-headed surviving path");
    assert.strictEqual(recalc.parts.length, 2);
});

test("an empty chunk syncs nothing", async () => {
    const harness = await setup();
    const events = captureEvents(harness);
    harness.dispatchMessage(new SetViewportMessage([chunkId(1, 1)]));

    assert.ok(!events.some(event => event instanceof ChunkSyncEvent));
});

test("leaving a chunk unsubscribes it; re-entering re-syncs only the delta", async () => {
    const harness = await setup();
    createBelt(harness, BeltType.NORMAL, {x: 1, y: 1, direction: Direction.UP});

    const events = captureEvents(harness);
    harness.dispatchMessage(new SetViewportMessage([chunkId(1, 1)]));
    events.length = 0;

    // Pan away: the chunk leaves the viewport.
    harness.dispatchMessage(new SetViewportMessage([chunkId(500, 500)]));
    const unsubscribe = events.find(event =>
        event instanceof ChunkUnsubscribeEvent
        && event.chunk === chunkId(1, 1));
    assert.ok(unsubscribe, "expected a chunk-unsubscribe for the chunk left behind");
    // The empty chunk we panned into syncs nothing.
    assert.ok(!events.some(event => event instanceof ChunkSyncEvent));

    // Pan back: only the re-entered chunk is synced again.
    events.length = 0;
    harness.dispatchMessage(new SetViewportMessage([chunkId(1, 1)]));
    const resync = events.find(event => event instanceof ChunkSyncEvent);
    assert.ok(resync, "expected a re-sync when the chunk re-enters the viewport");
    // One belt sync plus the path-recalc sync for its path.
    assert.strictEqual(resync.events.length, 2);
});

test("extending a path's tail re-syncs its items to a watching client", async () => {
    const harness = await setup();
    // A run flowing RIGHT, tail (output) at x = 3, with an in-flight item.
    createBelt(harness, BeltType.NORMAL, {x: 1, y: 1, direction: Direction.RIGHT});
    createBelt(harness, BeltType.NORMAL, {x: 2, y: 1, direction: Direction.RIGHT});
    createBelt(harness, BeltType.NORMAL, {x: 3, y: 1, direction: Direction.RIGHT});
    harness.dispatchMessage(new SetViewportMessage([chunkId(1, 1)]));

    const head = Number(harness.rawScalar("SELECT path_id FROM Belt WHERE x = 1 AND y = 1"));
    harness.rawExec(`UPDATE Port SET item = 7 WHERE id = (SELECT in_port_id FROM BeltPath WHERE id = ${head})`);
    harness.tickAll();
    harness.tickAll();

    const events = captureEvents(harness);
    // Extend the tail by one belt. This re-rows the path under new item ids, so the
    // client must be re-synced now — the resync publishes immediately via
    // publishEventNow, whose routing must match the viewport's chunk ids.
    createBelt(harness, BeltType.NORMAL, {x: 4, y: 1, direction: Direction.RIGHT});

    const reset = events.find(event =>
        event instanceof BufferedEvent && event.type === BUFFERED_EVENT_TYPE_ITEM_RESET);
    assert.ok(reset, "expected an item RESET for the re-rowed path");

    // The synced rows must mirror the rebuilt RLE exactly; a dropped resync (the old
    // string chunk key never matched the viewport) would leave the client with stale
    // rows against the now-longer path, teleporting the item a tile on the next tick.
    const synced = events
        .filter(event => event instanceof BufferedEvent && event.type === BUFFERED_EVENT_TYPE_ITEM_SYNC)
        .sort((a, b) => Number(a.a) - Number(b.a))
        .map(event => `${Number(event.a)}:${Number(event.b)}:${Number(event.c)}`)
        .join(" ");
    const rows = harness.rawScalar(
        `SELECT group_concat(id || ':' || length || ':' || type, ' ') FROM BeltPathItem WHERE path_id = ${head} ORDER BY id`
    );
    assert.strictEqual(synced, rows);
});
