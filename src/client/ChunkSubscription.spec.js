import {test} from "node:test";
import assert from "node:assert/strict";

import {ChunkSubscription} from "@/client/ChunkSubscription.js";
import {SetViewportMessage, OverworldRequestMessage} from "@/common/CoreMessages.js";
import {ClientCache} from "@/client/state/ClientCache.js";
import {OVERWORLD_SCHEMA, OverworldWriter, OverworldView} from "@/client/state/OverworldState.js";
import {TILE_SIZE} from "@/client/constants.js";
import {CHUNK_SIZE} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";

const CHUNK_PX = CHUNK_SIZE * TILE_SIZE;

// The subscription reads only the viewport's world-pixel edges.
class FakeViewport {

    constructor() {
        this.coverChunks(0, 0, 1, 1);
    }

    /**
     * Places the viewport inside a chunk-aligned rect, a tile clear of every chunk border so a
     * nudge stays within the same chunks.
     * @returns {void}
     */
    coverChunks(chunkX, chunkY, widthChunks, heightChunks) {
        this.left = chunkX * CHUNK_PX + TILE_SIZE;
        this.top = chunkY * CHUNK_PX + TILE_SIZE;
        this.right = (chunkX + widthChunks) * CHUNK_PX - TILE_SIZE;
        this.bottom = (chunkY + heightChunks) * CHUNK_PX - TILE_SIZE;
    }
}

class FakeSession {

    constructor() {
        this.messages = [];
    }

    sendMessage(message) {
        this.messages.push(message);
    }
}

class FakeStatusLayer {

    constructor() {
        this.loads = [];
    }

    beginChunkLoad(chunks) {
        this.loads.push(chunks);
    }
}

/**
 * @returns {{subscription: ChunkSubscription, viewport: FakeViewport, session: FakeSession,
 *     statusLayer: FakeStatusLayer}}
 */
function build() {
    const viewport = new FakeViewport();
    const cache = new ClientCache();
    cache.register("overworld", OVERWORLD_SCHEMA, new OverworldWriter(cache), new OverworldView());
    const session = new FakeSession();
    const statusLayer = new FakeStatusLayer();
    return {
        subscription: new ChunkSubscription(viewport, cache, session, statusLayer),
        viewport,
        session,
        statusLayer,
    };
}

/**
 * @returns {number[]} the chunk set of the last viewport message sent
 */
function lastViewport(session) {
    const messages = session.messages.filter(message => message instanceof SetViewportMessage);
    return messages.at(-1).chunks;
}

test("a moved viewport subscribes the chunks it covers, plus the leading ring", () => {
    const {subscription, viewport, session} = build();
    viewport.coverChunks(0, 0, 1, 1);
    subscription.viewportMoved();

    // The sweep starts one chunk before the top-left corner, so the chunk a pan is heading into
    // is already loading.
    assert.deepEqual(lastViewport(session).sort(), [
        chunkId(-CHUNK_SIZE, -CHUNK_SIZE),
        chunkId(-CHUNK_SIZE, 0),
        chunkId(0, -CHUNK_SIZE),
        chunkId(0, 0),
    ].sort());
});

test("subscribing drives the chunk-loading status; unsubscribing alone does not", () => {
    const {subscription, viewport, statusLayer} = build();
    viewport.coverChunks(0, 0, 1, 1);
    subscription.viewportMoved();
    assert.equal(statusLayer.loads.length, 1);

    // Far enough that every old chunk falls outside the hysteresis ring, and every new one is new.
    viewport.coverChunks(20, 20, 1, 1);
    subscription.viewportMoved();
    assert.equal(statusLayer.loads.length, 2);
});

test("a viewport move covering the same chunks sends nothing", () => {
    const {subscription, viewport, session} = build();
    viewport.coverChunks(0, 0, 1, 1);
    subscription.viewportMoved();
    const sent = session.messages.length;

    // A sub-tile nudge inside the same covered rect.
    viewport.left += 1;
    viewport.right += 1;
    subscription.viewportMoved();
    assert.equal(session.messages.length, sent);
});

test("a chunk one ring outside the view stays subscribed, two rings out drops", () => {
    const {subscription, viewport, session} = build();
    viewport.coverChunks(0, 0, 1, 1);
    subscription.viewportMoved();
    const corner = chunkId(-CHUNK_SIZE, -CHUNK_SIZE);
    assert.ok(lastViewport(session).includes(corner));

    // One chunk right: the corner is now outside the view but inside the retention ring.
    viewport.coverChunks(1, 0, 1, 1);
    subscription.viewportMoved();
    assert.ok(lastViewport(session).includes(corner), "grazing a boundary must not re-sync");

    viewport.coverChunks(3, 0, 1, 1);
    subscription.viewportMoved();
    assert.ok(!lastViewport(session).includes(corner));
});

test("entering overworld drops every subscription and requests a snapshot", () => {
    const {subscription, viewport, session} = build();
    viewport.coverChunks(0, 0, 1, 1);
    subscription.viewportMoved();

    subscription.enterOverworld();
    assert.deepEqual(lastViewport(session), []);
    const requests = session.messages.filter(message => message instanceof OverworldRequestMessage);
    assert.equal(requests.length, 1);
    assert.deepEqual(
        [requests[0].chunkX, requests[0].chunkY, requests[0].chunkWidth, requests[0].chunkHeight],
        [0, 0, 1, 1],
    );
});

test("overworld mode mounts no chunks and subscribes none while panning", () => {
    const {subscription, viewport, session} = build();
    subscription.enterOverworld();
    assert.equal(subscription.visibleChunks().size, 0);

    const sent = session.messages.filter(message => message instanceof SetViewportMessage).length;
    viewport.coverChunks(40, 40, 1, 1);
    subscription.viewportMoved();
    assert.equal(session.messages.filter(message => message instanceof SetViewportMessage).length, sent);
});

test("leaving overworld resubscribes the visible chunks", () => {
    const {subscription, viewport, session} = build();
    viewport.coverChunks(0, 0, 1, 1);
    subscription.viewportMoved();
    subscription.enterOverworld();

    subscription.leaveOverworld();
    assert.equal(lastViewport(session).length, 4);
});

test("a resync re-sends the viewport even though it never moved", () => {
    const {subscription, viewport, session} = build();
    viewport.coverChunks(0, 0, 1, 1);
    subscription.viewportMoved();
    const sent = session.messages.length;

    subscription.resync();
    assert.equal(session.messages.length, sent + 1);
    assert.equal(lastViewport(session).length, 4);
});

test("the mounted chunk set covers the view with a ring on every side", () => {
    const {subscription, viewport} = build();
    viewport.coverChunks(0, 0, 1, 1);
    // The covered chunk plus a ring on every side.
    assert.equal(subscription.visibleChunks().size, 3 * 3);
});
