import {test} from "node:test";
import assert from "node:assert/strict";

import {CenterLock} from "@/client/CenterLock.js";
import Mouse from "@/client/input/Mouse.js";
import {TILE_SIZE, ViewMode} from "@/client/constants.js";
import {Direction} from "@/common/constants.js";

const SCREEN_WIDTH = 800;
const SCREEN_HEIGHT = 600;
const TILE_X = 4;
const TILE_Y = 7;

/**
 * The world center of a tile, where an advance lands.
 * @returns {{x: number, y: number}}
 */
function tileCenter(tileX, tileY) {
    return {x: tileX * TILE_SIZE + TILE_SIZE / 2, y: tileY * TILE_SIZE + TILE_SIZE / 2};
}

class FakeViewport {

    constructor() {
        this.screenWidth = SCREEN_WIDTH;
        this.screenHeight = SCREEN_HEIGHT;
        this.glides = [];
    }

    glideTo(target) {
        this.glides.push(target);
    }

    on() {}

    toWorld() {
        return {x: 0, y: 0};
    }
}

class FakeClient {

    constructor() {
        this.viewport = new FakeViewport();
        this.app = {
            renderer: {on: () => {}},
            ticker: {add: () => {}},
            canvas: {addEventListener: () => {}},
        };
        this.viewMode = {current: ViewMode.MAP};
        this.chunkMode = {active: true};
        this.layerCenterLock = null;
        this.drawLayerRegistry = {setCenterLock: enabled => {
            this.layerCenterLock = enabled;
        }};
    }
}

/**
 * @returns {{centerLock: CenterLock, client: FakeClient}}
 */
function build() {
    const client = new FakeClient();
    // Center-lock drives the shared input singleton, which needs a viewport to read a center tile.
    Mouse.reset();
    Mouse.init(client.app, client.viewport);
    return {centerLock: new CenterLock(client), client};
}

test("center-lock starts off, with the marker hidden", () => {
    const {centerLock} = build();
    assert.equal(centerLock.enabled, false);
    assert.equal(centerLock.markerLayer.visible, false);
});

test("enabling puts the draw layers into center-lock too", () => {
    const {centerLock, client} = build();
    centerLock.setEnabled(true);
    assert.equal(centerLock.enabled, true);
    assert.equal(client.layerCenterLock, true);
});

test("re-enabling an already-enabled lock changes nothing", () => {
    const {centerLock, client} = build();
    centerLock.setEnabled(true);
    client.layerCenterLock = null;
    centerLock.setEnabled(true);
    assert.equal(client.layerCenterLock, null);
});

test("the marker shows only while locked, picking chunks, and out of world view", () => {
    const {centerLock, client} = build();
    centerLock.setEnabled(true);
    assert.equal(centerLock.markerLayer.visible, true);

    client.viewMode.current = ViewMode.WORLD;
    centerLock.refreshMarker();
    assert.equal(centerLock.markerLayer.visible, false, "world view aims with the cursor");

    client.viewMode.current = ViewMode.MAP;
    client.chunkMode.active = false;
    centerLock.refreshMarker();
    assert.equal(centerLock.markerLayer.visible, false, "nothing is being picked");

    client.chunkMode.active = true;
    centerLock.setEnabled(false);
    assert.equal(centerLock.markerLayer.visible, false);
});

test("the marker sits at the viewport's screen center", () => {
    const {centerLock} = build();
    assert.equal(centerLock.markerLayer.x, SCREEN_WIDTH / 2);
    assert.equal(centerLock.markerLayer.y, SCREEN_HEIGHT / 2);
});

test("an advance glides one tile along the direction", () => {
    const {centerLock, client} = build();
    centerLock.setEnabled(true);
    centerLock.advance(TILE_X, TILE_Y, Direction.RIGHT);
    assert.deepEqual(client.viewport.glides, [tileCenter(TILE_X + 1, TILE_Y)]);
});

test("a multi-tile advance lands absolutely, so rapid taps never drift", () => {
    const {centerLock, client} = build();
    centerLock.setEnabled(true);
    centerLock.advance(TILE_X, TILE_Y, Direction.DOWN, 2);
    centerLock.advance(TILE_X, TILE_Y, Direction.DOWN, 2);
    assert.deepEqual(client.viewport.glides, [
        tileCenter(TILE_X, TILE_Y + 2),
        tileCenter(TILE_X, TILE_Y + 2),
    ]);
});

test("an advance off center-lock is a no-op", () => {
    const {centerLock, client} = build();
    centerLock.advance(TILE_X, TILE_Y, Direction.RIGHT);
    assert.deepEqual(client.viewport.glides, []);
});
