import {test} from "node:test";
import assert from "node:assert/strict";

import {Container} from "pixi.js";
import {toolbarVisible, counterListTop, friendsPanelRefreshDue, mountsInPanelHost} from "@/client/Hud.js";
import {HudLayer} from "@/client/hud/HudLayer.js";
import {ViewMode, FRIENDS_PANEL_REFRESH_THROTTLE_MS} from "@/client/constants.js";

// The layers themselves need a renderer, but the decisions they lay out against do not.
const HAS_CLAIMS = true;
const NO_CLAIMS = false;
const TOP_BAR_HEIGHT = 40;
const STATUS_HEIGHT = 18;
const SAFE_AREA_TOP = 24;
const NOW = 10_000;

test("the toolbar is up in world view once the player holds a chunk", () => {
    assert.equal(toolbarVisible(HAS_CLAIMS, ViewMode.WORLD), true);
});

test("the toolbar stays down with nothing to build on", () => {
    assert.equal(toolbarVisible(NO_CLAIMS, ViewMode.WORLD), false);
});

test("the toolbar stays down while zoomed out, claims or not", () => {
    assert.equal(toolbarVisible(HAS_CLAIMS, ViewMode.MAP), false);
    assert.equal(toolbarVisible(HAS_CLAIMS, ViewMode.OVERWORLD), false);
});

test("the counter list stacks under the top bar and the status message", () => {
    assert.equal(
        counterListTop(TOP_BAR_HEIGHT, STATUS_HEIGHT, SAFE_AREA_TOP),
        TOP_BAR_HEIGHT + STATUS_HEIGHT,
    );
});

test("with the top bar hidden, the safe-area inset holds the top edge", () => {
    assert.equal(counterListTop(0, STATUS_HEIGHT, SAFE_AREA_TOP), SAFE_AREA_TOP + STATUS_HEIGHT);
});

test("a top bar taller than the inset already covers it", () => {
    // The bar's own height includes the inset, so the two must never add up.
    assert.equal(counterListTop(TOP_BAR_HEIGHT, 0, SAFE_AREA_TOP), TOP_BAR_HEIGHT);
});

test("the friend roster rebuilds once the throttle window has passed", () => {
    assert.equal(friendsPanelRefreshDue(NOW, NOW - FRIENDS_PANEL_REFRESH_THROTTLE_MS), true);
    assert.equal(friendsPanelRefreshDue(NOW, NOW - FRIENDS_PANEL_REFRESH_THROTTLE_MS + 1), false);
});

test("the first move of a session rebuilds the roster", () => {
    assert.equal(friendsPanelRefreshDue(NOW, 0), true);
});

test("a mod's band-less panel layer mounts into the panel host", () => {
    assert.equal(mountsInPanelHost(new Container()), true);
});

test("a mod's tooltip keeps the band it brought, so it mounts on the stage", () => {
    const tooltip = new Container();
    tooltip.zIndex = HudLayer.TOOLTIP;
    assert.equal(mountsInPanelHost(tooltip), false);
});
