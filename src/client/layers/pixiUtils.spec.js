import {test} from "node:test";
import assert from "node:assert/strict";
import {Container, Rectangle} from "pixi.js";
import {PointerHarness} from "@/test/PointerHarness.js";
import {trackTap, isTopmostAt, fitIcon} from "@/client/layers/pixiUtils.js";
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

/**
 * A hit-testable box on the harness at the standard button rect.
 * @param {PointerHarness} harness
 * @param {number} [width]
 * @param {number} [height]
 * @returns {Container}
 */
function buildBox(harness, width = BUTTON_WIDTH, height = BUTTON_HEIGHT) {
    const box = new Container();
    box.eventMode = "static";
    box.hitArea = new Rectangle(0, 0, width, height);
    return harness.add(box, BUTTON_X, BUTTON_Y);
}

test("an uncovered target is topmost at its own center", () => {
    const harness = new PointerHarness();
    const box = buildBox(harness);
    harness.sync();

    assert.equal(isTopmostAt(harness.boundary, box, INSIDE_X, INSIDE_Y), true);
});

test("a target covered by a later sibling is not topmost", () => {
    const harness = new PointerHarness();
    const box = buildBox(harness);
    // A dropdown's full-screen catcher, mounted over everything.
    const cover = new Container();
    cover.eventMode = "static";
    cover.hitArea = new Rectangle(0, 0, 800, 600);
    harness.add(cover);
    harness.sync();

    assert.equal(isTopmostAt(harness.boundary, box, INSIDE_X, INSIDE_Y), false);
});

test("a target is topmost where the cover does not reach", () => {
    const harness = new PointerHarness();
    const box = buildBox(harness);
    const cover = new Container();
    cover.eventMode = "static";
    cover.hitArea = new Rectangle(0, 0, 20, 20);
    harness.add(cover, 0, 0);
    harness.sync();

    assert.equal(isTopmostAt(harness.boundary, box, INSIDE_X, INSIDE_Y), true);
});

test("a target is topmost when the hit lands on its own child", () => {
    const harness = new PointerHarness();
    const box = buildBox(harness);
    const child = new Container();
    child.eventMode = "static";
    child.hitArea = new Rectangle(0, 0, 20, 20);
    box.addChild(child);
    harness.sync();

    assert.equal(isTopmostAt(harness.boundary, box, BUTTON_X + 10, BUTTON_Y + 10), true);
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

const SLOT_SIZE = 60;
const ICON_INSET = 6;
// The square the icon has to fit inside SLOT_SIZE once inset on every side.
const ICON_BOX = SLOT_SIZE - ICON_INSET * 2;

/**
 * A stand-in for the icon sprite, carrying only what {@link fitIcon} reads and writes.
 * @param {number} width - the source texture's width
 * @param {number} height
 * @returns {object}
 */
function stubIcon(width, height) {
    return {
        texture: {width, height},
        anchor: 0,
        scale: 1,
        position: {x: 0, y: 0, set(x, y) {
            this.x = x;
            this.y = y;
        }},
    };
}

test("a square icon scales to fill the inset box", () => {
    const icon = stubIcon(ICON_BOX * 2, ICON_BOX * 2);
    fitIcon(icon, SLOT_SIZE, ICON_INSET);
    assert.equal(icon.scale, 0.5);
});

test("a wide icon fits by its width, so it never spills sideways", () => {
    const icon = stubIcon(ICON_BOX * 4, ICON_BOX * 2);
    fitIcon(icon, SLOT_SIZE, ICON_INSET);
    assert.equal(icon.scale, 0.25);
});

test("a tall icon fits by its height", () => {
    const icon = stubIcon(ICON_BOX * 2, ICON_BOX * 4);
    fitIcon(icon, SLOT_SIZE, ICON_INSET);
    assert.equal(icon.scale, 0.25);
});

test("an icon smaller than the box scales up to it", () => {
    const icon = stubIcon(ICON_BOX / 2, ICON_BOX / 2);
    fitIcon(icon, SLOT_SIZE, ICON_INSET);
    assert.equal(icon.scale, 2);
});

test("a fitted icon is anchor-centered on the square's center, not on the inset box", () => {
    const icon = stubIcon(ICON_BOX, ICON_BOX * 2);
    fitIcon(icon, SLOT_SIZE, ICON_INSET);
    assert.equal(icon.anchor, 0.5);
    assert.deepEqual({x: icon.position.x, y: icon.position.y}, {x: SLOT_SIZE / 2, y: SLOT_SIZE / 2});
});
