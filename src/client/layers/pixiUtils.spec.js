import {test} from "node:test";
import assert from "node:assert/strict";
import {Container, Rectangle} from "pixi.js";
import {PointerHarness} from "@/test/PointerHarness.js";
import {trackTap} from "@/client/layers/pixiUtils.js";
import {TAP_MOVE_THRESHOLD} from "@/client/input/TapRecognizer.js";

const BUTTON_WIDTH = 100;
const BUTTON_HEIGHT = 40;
const BUTTON_X = 50;
const BUTTON_Y = 50;
// A point well inside the button, with room to travel without leaving it.
const INSIDE_X = BUTTON_X + BUTTON_WIDTH / 2;
const INSIDE_Y = BUTTON_Y + BUTTON_HEIGHT / 2;
const SECONDARY_BUTTON = 2;

/**
 * A tap-wired button on the harness, plus the taps it has fired.
 * @param {PointerHarness} harness
 * @param {object} [options] - passed through to trackTap
 * @returns {{button: Container, taps: number[]}}
 */
function buildButton(harness, options) {
    const button = new Container();
    button.hitArea = new Rectangle(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT);
    const taps = [];
    trackTap(button, () => taps.push(taps.length), options);
    harness.add(button, BUTTON_X, BUTTON_Y);
    return {button, taps};
}

test("a tap on a button fires it", () => {
    const harness = new PointerHarness();
    const {taps} = buildButton(harness);
    harness.tap(INSIDE_X, INSIDE_Y);
    assert.equal(taps.length, 1);
});

test("a drag across a button does not fire it", () => {
    const harness = new PointerHarness();
    const {taps} = buildButton(harness);
    // A scroll drag that begins and ends on the button: the classic touch misfire.
    harness.drag(INSIDE_X, INSIDE_Y - 10, INSIDE_X, INSIDE_Y + 10);
    assert.equal(taps.length, 0);
});

test("a press that barely moves still fires", () => {
    const harness = new PointerHarness();
    const {taps} = buildButton(harness);
    harness.drag(INSIDE_X, INSIDE_Y, INSIDE_X, INSIDE_Y + TAP_MOVE_THRESHOLD - 1, {steps: 1});
    assert.equal(taps.length, 1);
});

test("a release off the button does not fire it", () => {
    const harness = new PointerHarness();
    const {taps} = buildButton(harness);
    harness.down(INSIDE_X, INSIDE_Y);
    harness.up(INSIDE_X, BUTTON_Y + BUTTON_HEIGHT + 40);
    assert.equal(taps.length, 0);
});

test("a secondary-button press does not fire it", () => {
    const harness = new PointerHarness();
    const {taps} = buildButton(harness);
    harness.tap(INSIDE_X, INSIDE_Y, {button: SECONDARY_BUTTON});
    assert.equal(taps.length, 0);
});

test("a canceled drag leaves the button tappable", () => {
    const harness = new PointerHarness();
    const {taps} = buildButton(harness);
    harness.drag(INSIDE_X, INSIDE_Y, INSIDE_X, INSIDE_Y + 20);
    harness.tap(INSIDE_X, INSIDE_Y);
    assert.equal(taps.length, 1);
});

test("a press stops propagating to the container behind by default", () => {
    const harness = new PointerHarness();
    const behind = new Container();
    behind.eventMode = "static";
    behind.hitArea = new Rectangle(0, 0, 400, 400);
    const presses = [];
    behind.on("pointerdown", () => presses.push(1));
    harness.add(behind);
    const {button} = buildButton(harness);
    behind.addChild(button);

    harness.down(INSIDE_X, INSIDE_Y);
    assert.equal(presses.length, 0);
});

test("stopPropagation false lets the press reach the container behind", () => {
    const harness = new PointerHarness();
    const behind = new Container();
    behind.eventMode = "static";
    behind.hitArea = new Rectangle(0, 0, 400, 400);
    const presses = [];
    behind.on("pointerdown", () => presses.push(1));
    harness.add(behind);
    const {button} = buildButton(harness, {stopPropagation: false});
    behind.addChild(button);

    harness.down(INSIDE_X, INSIDE_Y);
    assert.equal(presses.length, 1);
});

test("a second pointer does not steal the press from the first", () => {
    const harness = new PointerHarness();
    const {taps} = buildButton(harness);
    harness.down(INSIDE_X, INSIDE_Y, {pointerId: 1});
    harness.down(INSIDE_X, INSIDE_Y, {pointerId: 2});
    harness.up(INSIDE_X, INSIDE_Y, {pointerId: 2});
    assert.equal(taps.length, 0);
    harness.up(INSIDE_X, INSIDE_Y, {pointerId: 1});
    assert.equal(taps.length, 1);
});
