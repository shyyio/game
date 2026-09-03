import {test} from "node:test";
import assert from "node:assert/strict";
import {Texture} from "pixi.js";
import {PointerHarness} from "@/test/PointerHarness.js";
import {ScrollView} from "@/client/hud/ScrollView.js";
import {TAP_MOVE_THRESHOLD} from "@/client/input/TapRecognizer.js";

const VIEW_WIDTH = 200;
const VIEW_HEIGHT = 100;
// Twice the viewport, so there is somewhere to scroll to.
const CONTENT_HEIGHT = VIEW_HEIGHT * 2;
// Well inside the view, clear of the scrollbar gutter on the right.
const INSIDE_X = 50;
const INSIDE_Y = 50;
const DRAG_DISTANCE = 40;
const SECONDARY_BUTTON = 2;
const OTHER_POINTER = 2;

// The frame sprites are the only thing the view asks of the registry, and nothing here renders them.
const textureRegistry = {get: () => Texture.EMPTY};

/**
 * A scrollable view mounted on a harness, with content twice the viewport height.
 * @returns {{harness: PointerHarness, view: ScrollView}}
 */
function build() {
    const harness = new PointerHarness();
    const view = new ScrollView(textureRegistry, VIEW_WIDTH, VIEW_HEIGHT);
    view.setContentHeight(CONTENT_HEIGHT);
    harness.add(view);
    harness.sync();
    return {harness, view};
}

test("dragging the content scrolls it", () => {
    const {harness, view} = build();
    harness.drag(INSIDE_X, INSIDE_Y, INSIDE_X, INSIDE_Y - DRAG_DISTANCE);
    assert.equal(view.scrollY, DRAG_DISTANCE);
});

test("a drag short of the threshold leaves the scroll alone, so a row underneath stays tappable", () => {
    const {harness, view} = build();
    harness.drag(INSIDE_X, INSIDE_Y, INSIDE_X, INSIDE_Y - (TAP_MOVE_THRESHOLD - 1), {steps: 1});
    assert.equal(view.scrollY, 0);
});

test("a secondary-button drag does not scroll", () => {
    const {harness, view} = build();
    harness.drag(INSIDE_X, INSIDE_Y, INSIDE_X, INSIDE_Y - DRAG_DISTANCE, {button: SECONDARY_BUTTON});
    assert.equal(view.scrollY, 0);
});

test("a second pointer's travel does not scroll the view another pointer is holding", () => {
    const {harness, view} = build();
    harness.down(INSIDE_X, INSIDE_Y);
    harness.move(INSIDE_X, INSIDE_Y - DRAG_DISTANCE, {pointerId: OTHER_POINTER});
    assert.equal(view.scrollY, 0);
});
