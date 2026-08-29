import {test} from "node:test";
import assert from "node:assert/strict";
import {Container, Graphics} from "pixi.js";
import {PointerHarness} from "@/test/PointerHarness.js";
import {PanelHost} from "@/client/hud/PanelHost.js";
import {HudLayer} from "@/client/hud/HudLayer.js";

const SCREEN_WIDTH = 800;
const SCREEN_HEIGHT = 600;
const BOX_SIZE = 200;

/**
 * A layer holding one interactive box at (x, y).
 * @param {number} x
 * @param {number} y
 * @returns {Container}
 */
function layerWithBox(x, y) {
    const layer = new Container();
    const box = new Graphics().rect(0, 0, BOX_SIZE, BOX_SIZE).fill(0xffffff);
    box.eventMode = "static";
    box.position.set(x, y);
    layer.addChild(box);
    return layer;
}

/**
 * Two overlapping layers on a harness, the second mounted over the first.
 * @returns {{harness: PointerHarness, host: PanelHost, first: Container, second: Container}}
 */
function build() {
    const harness = new PointerHarness(SCREEN_WIDTH, SCREEN_HEIGHT);
    const host = new PanelHost();
    const first = layerWithBox(50, 50);
    const second = layerWithBox(100, 100);
    host.add(first);
    host.add(second);
    harness.add(host);
    harness.sync();
    return {harness, host, first, second};
}

test("the host carries the panel band for its layers", () => {
    const {host, first} = build();

    assert.equal(host.zIndex, HudLayer.PANEL);
    assert.equal(first.zIndex, 0);
});

test("pressing a layer raises it over the one mounted after it", () => {
    const {harness, host, first} = build();

    // (60, 60) is over the first layer's box alone.
    harness.down(60, 60);

    assert.equal(host.children[host.children.length - 1], first);
});

test("the layer under the press wins, whichever was raised last", () => {
    const {harness, host, first, second} = build();

    harness.down(60, 60);
    // (250, 250) is over the second layer's box alone.
    harness.down(250, 250);

    assert.equal(host.children[host.children.length - 1], second);
    assert.equal(host.children[0], first);
});

test("a control that stops the press propagating still raises its layer", () => {
    const {harness, host, first} = build();
    first.children[0].on("pointerdown", (event) => event.stopPropagation());

    harness.down(60, 60);

    assert.equal(host.children[host.children.length - 1], first);
});

test("a press landing on no layer leaves the order alone", () => {
    const {harness, host, second} = build();

    harness.down(700, 500);

    assert.equal(host.children[host.children.length - 1], second);
});

test("a layer stamping its own zIndex is refused", () => {
    const host = new PanelHost();
    const layer = new Container();
    layer.zIndex = HudLayer.PANEL;

    assert.throws(() => host.add(layer), /takes its stacking from the panel host/);
});
