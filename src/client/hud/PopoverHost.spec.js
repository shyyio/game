import {test} from "node:test";
import assert from "node:assert/strict";
import {Graphics} from "pixi.js";
import {PointerHarness} from "@/test/PointerHarness.js";
import {PopoverHost} from "@/client/hud/PopoverHost.js";

const SCREEN_WIDTH = 800;
const SCREEN_HEIGHT = 600;
const POPOVER_GAP = 4;
const POPOVER_MARGIN = 8;
const ANCHOR_WIDTH = 60;
const ANCHOR_HEIGHT = 30;
const CONTENT_WIDTH = 300;

/**
 * Stands in for the pixi Application: a popover reads only the screen size and the resize event.
 */
class FakeApp {

    /**
     * @param {number} width
     * @param {number} height
     */
    constructor(width, height) {
        this.screen = {width, height};
        this.renderer = {on() {}};
    }
}

/**
 * @param {number} width
 * @param {number} height
 * @returns {Graphics}
 */
function block(width, height) {
    return new Graphics().rect(0, 0, width, height).fill(0xffffff);
}

/**
 * A host mounted on a harness, with an anchor placed at (x, y).
 * @param {number} anchorX
 * @param {number} anchorY
 * @returns {{harness: PointerHarness, host: PopoverHost, anchor: Graphics}}
 */
function build(anchorX, anchorY) {
    const harness = new PointerHarness(SCREEN_WIDTH, SCREEN_HEIGHT);
    const host = new PopoverHost(new FakeApp(SCREEN_WIDTH, SCREEN_HEIGHT));
    const anchor = harness.add(block(ANCHOR_WIDTH, ANCHOR_HEIGHT), anchorX, anchorY);
    harness.add(host);
    harness.sync();
    return {harness, host, anchor};
}

test("a popover drops below its anchor", () => {
    const {host, anchor} = build(100, 100);
    const content = block(CONTENT_WIDTH, 200);
    host.open({content, height: 200, anchorTo: anchor});

    assert.equal(content.x, 100);
    assert.equal(content.y, 100 + ANCHOR_HEIGHT + POPOVER_GAP);
    assert.equal(host.isOpen, true);
});

test("a popover that would run off the bottom flips above its anchor", () => {
    const {host, anchor} = build(100, SCREEN_HEIGHT - 100);
    const content = block(CONTENT_WIDTH, 200);
    host.open({content, height: 200, anchorTo: anchor});

    assert.equal(content.y, SCREEN_HEIGHT - 100 - POPOVER_GAP - 200);
});

test("a popover is clamped inside the right edge", () => {
    const {host, anchor} = build(SCREEN_WIDTH - ANCHOR_WIDTH, 100);
    const content = block(CONTENT_WIDTH, 100);
    host.open({content, height: 100, anchorTo: anchor});

    assert.equal(content.x, SCREEN_WIDTH - CONTENT_WIDTH - POPOVER_MARGIN);
});

test("a popover is clamped inside the left edge", () => {
    const {host, anchor} = build(0, 100);
    const content = block(CONTENT_WIDTH, 100);
    host.open({content, height: 100, anchorTo: anchor});

    assert.equal(content.x, POPOVER_MARGIN);
});

test("a popover too tall for either side is pinned to the top margin", () => {
    const {host, anchor} = build(100, SCREEN_HEIGHT - 100);
    const content = block(CONTENT_WIDTH, SCREEN_HEIGHT);
    host.open({content, height: SCREEN_HEIGHT, anchorTo: anchor});

    assert.equal(content.y, POPOVER_MARGIN);
});

test("opening replaces whatever was open", () => {
    const {host, anchor} = build(100, 100);
    const first = block(CONTENT_WIDTH, 100);
    host.open({content: first, height: 100, anchorTo: anchor});
    const second = block(CONTENT_WIDTH, 100);
    host.open({content: second, height: 100, anchorTo: anchor});

    assert.equal(first.destroyed, true);
    assert.equal(host.isOpen, true);
});

test("close destroys the content and reports shut", () => {
    const {host, anchor} = build(100, 100);
    const content = block(CONTENT_WIDTH, 100);
    host.open({content, height: 100, anchorTo: anchor});
    host.close();

    assert.equal(content.destroyed, true);
    assert.equal(host.isOpen, false);
    assert.equal(host.visible, false);
});

test("close on an empty host does nothing", () => {
    const {host} = build(100, 100);
    host.close();

    assert.equal(host.isOpen, false);
});

test("onClose fires once, on whichever close happens", () => {
    const {host, anchor} = build(100, 100);
    let closes = 0;
    host.open({content: block(CONTENT_WIDTH, 100), height: 100, anchorTo: anchor, onClose: () => closes += 1});
    host.close();
    host.close();

    assert.equal(closes, 1);
});

test("a tap away from the popover dismisses it", () => {
    const {harness, host, anchor} = build(100, 100);
    host.open({content: block(CONTENT_WIDTH, 100), height: 100, anchorTo: anchor});
    harness.tap(SCREEN_WIDTH - 20, SCREEN_HEIGHT - 20);

    assert.equal(host.isOpen, false);
});

test("a tap on the popover leaves it open", () => {
    const {harness, host, anchor} = build(100, 100);
    const content = block(CONTENT_WIDTH, 100);
    host.open({content, height: 100, anchorTo: anchor});
    harness.tap(content.x + 10, content.y + 10);

    assert.equal(host.isOpen, true);
});

test("a drag away from the popover does not dismiss it", () => {
    const {harness, host, anchor} = build(100, 100);
    host.open({content: block(CONTENT_WIDTH, 100), height: 100, anchorTo: anchor});
    harness.drag(SCREEN_WIDTH - 20, SCREEN_HEIGHT - 20, SCREEN_WIDTH - 20, SCREEN_HEIGHT - 80);

    assert.equal(host.isOpen, true);
});
