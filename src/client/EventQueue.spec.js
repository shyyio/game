import {test} from "node:test";
import assert from "node:assert/strict";

import {EventQueue} from "@/client/EventQueue.js";
import {AbstractChunkRoutedEvent} from "@/common/AbstractChunkRoutedEvent.js";
import {AbstractBatchEvent} from "@/common/AbstractBatchEvent.js";
import {AbstractEvent} from "@/common/AbstractEvent.js";
import {ChunkSyncEvent, ChunkUnsubscribeEvent} from "@/common/CoreEvents.js";
import {chunkId} from "@/common/util.js";
import {CHUNK_SIZE} from "@/common/constants.js";

// One tile deep in each of two chunks, so a "chunk" is a real routed id.
const IN_CHUNK_A = 1;
const IN_CHUNK_B = CHUNK_SIZE + 1;
const CHUNK_A = chunkId(IN_CHUNK_A, IN_CHUNK_A);
const CHUNK_B = chunkId(IN_CHUNK_B, IN_CHUNK_B);

class TileEvent extends AbstractChunkRoutedEvent {

    static wireFields = {tile: "int32"};

    /**
     * @param {number} tile - a tile position, doubling as the event's identity in assertions
     */
    constructor(tile) {
        super(tile, tile);
        this.tile = tile;
    }
}

class TileBatchEvent extends AbstractBatchEvent {

    static wireFields = {tiles: "int32[]"};

    /**
     * @param {number[]} tiles
     */
    constructor(tiles) {
        super(tiles[0], tiles[0]);
        this.tiles = tiles;
    }

    explode() {
        return this.tiles.map(tile => new TileEvent(tile));
    }
}

// A position-less event, routed to no chunk and so never gated.
class GlobalEvent extends AbstractEvent {

    static wireFields = {};

}

/**
 * The four consumers the queue fans an event out to, each recording what it saw.
 */
class FakeClient {

    constructor() {
        this.applied = [];
        this.cache = {onEvent: event => this.applied.push(["cache", event])};
        this.drawLayerRegistry = {dispatchEvent: event => this.applied.push(["layers", event])};
        this.hud = {statusLayer: {onEvent: event => this.applied.push(["status", event])}};
        this.modRegistry = {
            clientMods: [{onEvent: (event, client) => this.applied.push(["mod", event, client])}],
        };
    }

    /**
     * @returns {number[]} the tile of every TileEvent the cache has seen, in order
     */
    appliedTiles() {
        return this.applied
            .filter(([consumer, event]) => consumer === "cache" && event instanceof TileEvent)
            .map(([, event]) => event.tile);
    }
}

/**
 * @returns {{queue: EventQueue, client: FakeClient}}
 */
function build() {
    const client = new FakeClient();
    return {queue: new EventQueue(client), client};
}

test("an event whose chunk has no queued sync applies on arrival", () => {
    const {queue, client} = build();
    queue.publish(new TileEvent(IN_CHUNK_A));
    assert.deepEqual(client.appliedTiles(), [IN_CHUNK_A]);
});

test("an applied event reaches the cache, the mods, the layers and the status HUD, in that order", () => {
    const {queue, client} = build();
    const event = new GlobalEvent();
    queue.publish(event);
    assert.deepEqual(client.applied.map(([consumer]) => consumer), ["cache", "mod", "layers", "status"]);
    assert.equal(client.applied[1][2], client, "a mod is handed the client with the event");
});

test("a batch event applies as its per-delta events, never itself", () => {
    const {queue, client} = build();
    queue.publish(new TileBatchEvent([IN_CHUNK_A, IN_CHUNK_A + 1]));
    assert.deepEqual(client.appliedTiles(), [IN_CHUNK_A, IN_CHUNK_A + 1]);
});

test("a chunk sync bundle queues rather than applying, exploded to its deltas", () => {
    const {queue, client} = build();
    queue.publish(new ChunkSyncEvent(CHUNK_A, [new TileBatchEvent([IN_CHUNK_A, IN_CHUNK_A + 1])]));
    assert.deepEqual(client.appliedTiles(), []);

    queue.drain();
    assert.deepEqual(client.appliedTiles(), [IN_CHUNK_A, IN_CHUNK_A + 1]);
});

test("a later event on a syncing chunk applies behind that chunk's queue", () => {
    const {queue, client} = build();
    queue.publish(new ChunkSyncEvent(CHUNK_A, [new TileEvent(IN_CHUNK_A)]));
    queue.publish(new TileEvent(IN_CHUNK_A + 1));
    assert.deepEqual(client.appliedTiles(), [], "the live event must not overtake the sync");

    queue.drain();
    assert.deepEqual(client.appliedTiles(), [IN_CHUNK_A, IN_CHUNK_A + 1]);
});

test("live traffic for a settled chunk never queues behind another chunk's sync", () => {
    const {queue, client} = build();
    queue.publish(new ChunkSyncEvent(CHUNK_A, [new TileEvent(IN_CHUNK_A)]));
    queue.publish(new TileEvent(IN_CHUNK_B));
    assert.deepEqual(client.appliedTiles(), [IN_CHUNK_B]);
});

test("a drained chunk stops gating its later events", () => {
    const {queue, client} = build();
    queue.publish(new ChunkSyncEvent(CHUNK_A, [new TileEvent(IN_CHUNK_A)]));
    queue.drain();
    queue.publish(new TileEvent(IN_CHUNK_A + 1));
    assert.deepEqual(client.appliedTiles(), [IN_CHUNK_A, IN_CHUNK_A + 1]);
});

test("unsubscribing a chunk drops its queued sync, keeping every other chunk's", () => {
    const {queue, client} = build();
    queue.publish(new ChunkSyncEvent(CHUNK_A, [new TileEvent(IN_CHUNK_A)]));
    queue.publish(new ChunkSyncEvent(CHUNK_B, [new TileEvent(IN_CHUNK_B)]));

    queue.publish(new ChunkUnsubscribeEvent(CHUNK_A));
    queue.drain();
    assert.deepEqual(client.appliedTiles(), [IN_CHUNK_B]);
    // The unsubscribe itself rides the drain, so its teardown is budgeted like a sync.
    assert.ok(client.applied.some(([, event]) => event instanceof ChunkUnsubscribeEvent));
});

test("host listeners see every applied event, and unsubscribe", () => {
    const {queue} = build();
    const seen = [];
    const unsubscribe = queue.onEvent(event => seen.push(event));
    queue.publish(new TileEvent(IN_CHUNK_A));
    assert.equal(seen.length, 1);

    unsubscribe();
    queue.publish(new TileEvent(IN_CHUNK_A));
    assert.equal(seen.length, 1);
});

test("a drain with nothing queued is a no-op", () => {
    const {queue, client} = build();
    queue.drain();
    assert.deepEqual(client.applied, []);
});
