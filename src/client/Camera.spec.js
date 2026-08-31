import {test} from "node:test";
import assert from "node:assert/strict";

import {Camera} from "@/client/Camera.js";
import {TILE_SIZE} from "@/client/constants.js";
import {CHUNK_SIZE} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";

// A chunk's center in world pixels, the unit every assertion below is written in.
const CHUNK_PX = CHUNK_SIZE * TILE_SIZE;
const CHUNK_CENTER_PX = CHUNK_PX / 2;

class FakeViewport {

    constructor() {
        this.glides = [];
        this.snaps = [];
    }

    glideTo(target) {
        this.glides.push(target);
    }

    moveCenter(x, y) {
        this.snaps.push({x, y});
    }
}

/**
 * The two things the camera reads off the client, plus the fan-out its snap fires.
 */
class FakeClient {

    /**
     * @param {number[]} ownChunks
     */
    constructor(ownChunks) {
        this.viewport = new FakeViewport();
        this.moves = 0;
        this.cache = {view: () => ({ownChunks: () => ownChunks})};
    }

    viewportMoved() {
        this.moves += 1;
    }
}

/**
 * @param {number[]} ownChunks
 * @returns {{camera: Camera, client: FakeClient}}
 */
function build(ownChunks) {
    const client = new FakeClient(ownChunks);
    return {camera: new Camera(client), client};
}

test("one claimed chunk centers on that chunk", () => {
    const {camera} = build([chunkId(0, 0)]);
    assert.deepEqual(camera.ownClaimsCenter(), {x: CHUNK_CENTER_PX, y: CHUNK_CENTER_PX});
});

test("the center is the centroid of every claim, not their bounding box", () => {
    // Three in a row plus one below the leftmost: the centroid leans left of the box's center.
    const {camera} = build([
        chunkId(0, 0),
        chunkId(CHUNK_SIZE, 0),
        chunkId(2 * CHUNK_SIZE, 0),
        chunkId(0, CHUNK_SIZE),
    ]);
    assert.deepEqual(camera.ownClaimsCenter(), {
        x: CHUNK_CENTER_PX + 3 * CHUNK_PX / 4,
        y: CHUNK_CENTER_PX + CHUNK_PX / 4,
    });
});

test("claims across the origin average out to it", () => {
    const {camera} = build([chunkId(-CHUNK_SIZE, -CHUNK_SIZE), chunkId(0, 0)]);
    assert.deepEqual(camera.ownClaimsCenter(), {x: 0, y: 0});
});

test("no claims means no center", () => {
    const {camera} = build([]);
    assert.equal(camera.ownClaimsCenter(), null);
});

test("gliding home keeps the current zoom", () => {
    const {camera, client} = build([chunkId(0, 0)]);
    camera.glideHome();
    assert.deepEqual(client.viewport.glides, [{x: CHUNK_CENTER_PX, y: CHUNK_CENTER_PX}]);
});

test("starting at home snaps without a glide, and refreshes the data feed", () => {
    const {camera, client} = build([chunkId(0, 0)]);
    camera.startAtHome();
    assert.deepEqual(client.viewport.snaps, [{x: CHUNK_CENTER_PX, y: CHUNK_CENTER_PX}]);
    assert.deepEqual(client.viewport.glides, []);
    assert.equal(client.moves, 1, "moveCenter emits no moved event of its own");
});

test("both home moves are no-ops with nothing claimed", () => {
    const {camera, client} = build([]);
    camera.glideHome();
    camera.startAtHome();
    assert.deepEqual(client.viewport.glides, []);
    assert.deepEqual(client.viewport.snaps, []);
    assert.equal(client.moves, 0);
});
