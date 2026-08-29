import {test} from "node:test";
import assert from "node:assert/strict";
import {TapRecognizer, TAP_MOVE_THRESHOLD} from "./TapRecognizer.js";

const POINTER = 1;
const OTHER_POINTER = 2;
const PRIMARY = 0;
const SECONDARY = 2;

test("a press released in place is a tap", () => {
    const recognizer = new TapRecognizer();
    assert.equal(recognizer.press(POINTER, PRIMARY, 100, 100), true);
    assert.equal(recognizer.pressed, true);
    assert.equal(recognizer.release(POINTER), true);
    assert.equal(recognizer.pressed, false);
});

test("travel past the threshold cancels the tap", () => {
    const recognizer = new TapRecognizer();
    recognizer.press(POINTER, PRIMARY, 100, 100);
    recognizer.move(POINTER, 100, 100 + TAP_MOVE_THRESHOLD);
    assert.equal(recognizer.release(POINTER), false);
});

test("travel short of the threshold still taps", () => {
    const recognizer = new TapRecognizer();
    recognizer.press(POINTER, PRIMARY, 100, 100);
    recognizer.move(POINTER, 102, 102);
    assert.equal(recognizer.release(POINTER), true);
});

test("coming back under the threshold does not restore the tap", () => {
    const recognizer = new TapRecognizer();
    recognizer.press(POINTER, PRIMARY, 100, 100);
    recognizer.move(POINTER, 100, 200);
    recognizer.move(POINTER, 100, 100);
    assert.equal(recognizer.release(POINTER), false);
});

test("a non-primary button never claims the press", () => {
    const recognizer = new TapRecognizer();
    assert.equal(recognizer.press(POINTER, SECONDARY, 100, 100), false);
    assert.equal(recognizer.pressed, false);
    assert.equal(recognizer.release(POINTER), false);
});

test("a second pointer neither claims nor steals the press", () => {
    const recognizer = new TapRecognizer();
    recognizer.press(POINTER, PRIMARY, 100, 100);
    assert.equal(recognizer.press(OTHER_POINTER, PRIMARY, 300, 300), false);
    // The interloper's travel and release leave the held press alone.
    recognizer.move(OTHER_POINTER, 300, 400);
    assert.equal(recognizer.release(OTHER_POINTER), false);
    assert.equal(recognizer.release(POINTER), true);
});

test("cancel abandons the press without a tap", () => {
    const recognizer = new TapRecognizer();
    recognizer.press(POINTER, PRIMARY, 100, 100);
    recognizer.cancel(POINTER);
    assert.equal(recognizer.pressed, false);
    assert.equal(recognizer.release(POINTER), false);
});

test("a release without a press is not a tap", () => {
    const recognizer = new TapRecognizer();
    assert.equal(recognizer.release(POINTER), false);
});

test("the recognizer rearms after a canceled tap", () => {
    const recognizer = new TapRecognizer();
    recognizer.press(POINTER, PRIMARY, 100, 100);
    recognizer.move(POINTER, 100, 200);
    recognizer.release(POINTER);
    recognizer.press(POINTER, PRIMARY, 100, 100);
    assert.equal(recognizer.release(POINTER), true);
});
