import {test} from "node:test";
import assert from "node:assert/strict";

import {PAN_SPEED, PAN_DIRECTIONS, keyboardPanOffset} from "@/client/input/viewportPan.js";

const [UP, LEFT, DOWN, RIGHT] = PAN_DIRECTIONS;

// One second of held keys at zoom 1, so an offset reads as a plain multiple of the speed.
const ONE_SECOND_MS = 1000;

test("nothing held moves the view nowhere", () => {
    assert.deepEqual(keyboardPanOffset(new Set(), ONE_SECOND_MS, 1), {x: 0, y: 0});
});

test("a held direction pans a second's travel along its screen axis", () => {
    assert.deepEqual(keyboardPanOffset(new Set([UP]), ONE_SECOND_MS, 1), {x: 0, y: -PAN_SPEED});
    assert.deepEqual(keyboardPanOffset(new Set([DOWN]), ONE_SECOND_MS, 1), {x: 0, y: PAN_SPEED});
    assert.deepEqual(keyboardPanOffset(new Set([LEFT]), ONE_SECOND_MS, 1), {x: -PAN_SPEED, y: 0});
    assert.deepEqual(keyboardPanOffset(new Set([RIGHT]), ONE_SECOND_MS, 1), {x: PAN_SPEED, y: 0});
});

test("a diagonal travels the same distance as an axis", () => {
    const offset = keyboardPanOffset(new Set([UP, RIGHT]), ONE_SECOND_MS, 1);
    assert.equal(Math.round(Math.hypot(offset.x, offset.y)), PAN_SPEED);
    assert.equal(offset.x, -offset.y);
});

test("opposed directions cancel", () => {
    assert.deepEqual(keyboardPanOffset(new Set([LEFT, RIGHT]), ONE_SECOND_MS, 1), {x: 0, y: 0});
});

test("the travel is screen distance, so zooming out pans further in the world", () => {
    assert.deepEqual(keyboardPanOffset(new Set([RIGHT]), ONE_SECOND_MS, 0.25), {x: 4 * PAN_SPEED, y: 0});
});

test("a half-length frame pans half as far", () => {
    assert.deepEqual(keyboardPanOffset(new Set([RIGHT]), ONE_SECOND_MS / 2, 1), {x: PAN_SPEED / 2, y: 0});
});
