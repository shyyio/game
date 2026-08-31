import {test} from "node:test";
import assert from "node:assert/strict";

import {ViewModeController} from "@/client/ViewModeController.js";
import {ViewMode, MAP_MODE_SCALE_THRESHOLD, OVERWORLD_SCALE_THRESHOLD} from "@/client/constants.js";

const WORLD_SCALE = MAP_MODE_SCALE_THRESHOLD;
const MAP_SCALE = (MAP_MODE_SCALE_THRESHOLD + OVERWORLD_SCALE_THRESHOLD) / 2;
const OVERWORLD_SCALE = OVERWORLD_SCALE_THRESHOLD / 2;

/**
 * Every consumer the view-mode fan-out reaches, each recording the modes it was handed.
 */
class FakeClient {

    constructor() {
        this.viewport = {scale: {x: WORLD_SCALE}};
        this.told = [];
        this.previous = [];
        this.subscribed = [];
        this.drawLayerRegistry = {setViewMode: mode => this.told.push(["layers", mode])};
        this.hud = {
            mapButtonsLayer: {setViewMode: mode => this.told.push(["mapButtons", mode])},
            friendsPanelLayer: {setViewMode: mode => this.told.push(["friends", mode])},
            refreshToolbarVisibility: () => this.told.push(["toolbar", null]),
        };
        this.modRegistry = {clientMods: [{setViewMode: mode => this.told.push(["mod", mode])}]};
        this.claimSelection = {onViewMode: previous => this.previous.push(["claimSelection", previous])};
        this.settleFlow = {onViewMode: previous => this.previous.push(["settleFlow", previous])};
        this.subscription = {
            enterOverworld: () => this.subscribed.push("enter"),
            leaveOverworld: () => this.subscribed.push("leave"),
        };
    }
}

/**
 * @returns {{viewMode: ViewModeController, client: FakeClient}}
 */
function build() {
    const client = new FakeClient();
    return {viewMode: new ViewModeController(client), client};
}

/**
 * @returns {ViewMode} the mode the controller settles on at that viewport scale
 */
function modeAt(scale) {
    const {viewMode, client} = build();
    client.viewport.scale.x = scale;
    viewMode.update();
    return viewMode.current;
}

test("the view starts in world mode", () => {
    const {viewMode} = build();
    assert.equal(viewMode.current, ViewMode.WORLD);
});

test("each zoom band picks its mode, thresholds belonging to the band below", () => {
    assert.equal(modeAt(MAP_MODE_SCALE_THRESHOLD), ViewMode.WORLD);
    assert.equal(modeAt(MAP_MODE_SCALE_THRESHOLD - Number.EPSILON), ViewMode.MAP);
    assert.equal(modeAt(OVERWORLD_SCALE_THRESHOLD), ViewMode.MAP);
    assert.equal(modeAt(OVERWORLD_SCALE_THRESHOLD - Number.EPSILON), ViewMode.OVERWORLD);
});

test("a zoom staying inside the band tells nobody", () => {
    const {viewMode, client} = build();
    client.viewport.scale.x = WORLD_SCALE * 2;
    viewMode.update();
    assert.deepEqual(client.told, []);
});

test("crossing a band fans the new mode out to every consumer", () => {
    const {viewMode, client} = build();
    client.viewport.scale.x = MAP_SCALE;
    viewMode.update();
    assert.deepEqual(client.told, [
        ["layers", ViewMode.MAP],
        ["mapButtons", ViewMode.MAP],
        ["friends", ViewMode.MAP],
        ["toolbar", null],
        ["mod", ViewMode.MAP],
    ]);
});

test("the chunk-picking modes are handed the mode being left, not the new one", () => {
    const {viewMode, client} = build();
    client.viewport.scale.x = MAP_SCALE;
    viewMode.update();
    assert.deepEqual(client.previous, [
        ["claimSelection", ViewMode.WORLD],
        ["settleFlow", ViewMode.WORLD],
    ]);
});

test("the change handler sees each new mode once", () => {
    const {viewMode, client} = build();
    const seen = [];
    viewMode.onChange(mode => seen.push(mode));
    client.viewport.scale.x = MAP_SCALE;
    viewMode.update();
    viewMode.update();
    client.viewport.scale.x = OVERWORLD_SCALE;
    viewMode.update();
    assert.deepEqual(seen, [ViewMode.MAP, ViewMode.OVERWORLD]);
});

test("the overworld swaps the data feed on the way in and back out", () => {
    const {viewMode, client} = build();
    client.viewport.scale.x = OVERWORLD_SCALE;
    viewMode.update();
    assert.deepEqual(client.subscribed, ["enter"]);

    client.viewport.scale.x = MAP_SCALE;
    viewMode.update();
    assert.deepEqual(client.subscribed, ["enter", "leave"]);
});

test("moving between world and map never touches the data feed", () => {
    const {viewMode, client} = build();
    client.viewport.scale.x = MAP_SCALE;
    viewMode.update();
    client.viewport.scale.x = WORLD_SCALE;
    viewMode.update();
    assert.deepEqual(client.subscribed, []);
});
