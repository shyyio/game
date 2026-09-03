import {test} from "node:test";
import assert from "node:assert/strict";
import {Container, Graphics} from "pixi.js";
import {HoverTooltip, TooltipSide, TARGET_CLEARANCE} from "@/client/hud/HoverTooltip.js";
import {TOOLTIP_HOVER_DELAY_MS} from "@/client/hud/AbstractTooltipLayer.js";
import {HudLayer} from "@/client/hud/HudLayer.js";

const TARGET_WIDTH = 40;
const TARGET_HEIGHT = 30;
const TARGET_X = 100;
const TARGET_Y = 200;

/**
 * A stub application: a ticker that never runs on its own and a screen large enough to never clamp.
 * @returns {{app: object, tick: function(number): void}}
 */
function stubApp() {
    const callbacks = [];
    const ticker = {deltaMS: 0, add: callback => callbacks.push(callback)};
    const app = {ticker, screen: {width: 2000, height: 2000}};
    return {
        app,
        tick: (deltaMS) => {
            ticker.deltaMS = deltaMS;
            for (const callback of callbacks) {
                callback();
            }
        },
    };
}

/**
 * The tooltip without its box: sizing the box measures text, which needs a canvas.
 */
class Probe extends HoverTooltip {

    _redraw() {}
}

/**
 * A hoverable target of a known size, carrying tooltip text.
 * @returns {Container}
 */
function target() {
    const container = new Container();
    container.addChild(new Graphics().rect(0, 0, TARGET_WIDTH, TARGET_HEIGHT).fill(0xffffff));
    container.position.set(TARGET_X, TARGET_Y);
    container.tooltipText = "Cabbage Seed";
    return container;
}

test("shows the target's text after the dwell, below the target", () => {
    const {app, tick} = stubApp();
    const tooltip = new Probe(app, TooltipSide.BELOW, HudLayer.POPOVER);
    const cell = target();
    tooltip.setTarget(cell);
    tick(TOOLTIP_HOVER_DELAY_MS / 2);
    assert.equal(tooltip.visible, false);
    tick(TOOLTIP_HOVER_DELAY_MS);
    assert.equal(tooltip.visible, true);
    assert.equal(tooltip._label.text, "Cabbage Seed");
    assert.equal(tooltip.x, TARGET_X);
    assert.equal(tooltip.y, TARGET_Y + TARGET_HEIGHT + TARGET_CLEARANCE);
});

test("sits beside the target on the right side, and hides once the target is cleared", () => {
    const {app, tick} = stubApp();
    const tooltip = new Probe(app, TooltipSide.RIGHT, HudLayer.TOOLTIP);
    const row = target();
    tooltip.setTarget(row);
    tick(TOOLTIP_HOVER_DELAY_MS);
    assert.equal(tooltip.x, TARGET_X + TARGET_WIDTH + TARGET_CLEARANCE);
    assert.equal(tooltip.y, TARGET_Y);
    tooltip.clearTarget(row);
    tick(0);
    assert.equal(tooltip.visible, false);
});
