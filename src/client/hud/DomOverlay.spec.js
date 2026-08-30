import {test} from "node:test";
import assert from "node:assert/strict";
import {DomOverlay} from "@/client/hud/DomOverlay.js";

// The canvas sits inset from the page corner, so a bounds of (0, 0) still lands here.
const CANVAS_RECT = {left: 40, top: 20};

/**
 * A stand-in for the overlaid element, recording every style written to it.
 * @returns {object}
 */
function stubElement() {
    return {
        style: {},
        removed: false,
        remove() {
            this.removed = true;
        },
    };
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @returns {object}
 */
function bounds(x, y, width, height) {
    return {x, y, width, height};
}

test("a sync offsets the display object's bounds by the canvas's page position", () => {
    const element = stubElement();
    new DomOverlay(element).sync(bounds(10, 5, 100, 30), CANVAS_RECT);
    assert.equal(element.style.left, "50px");
    assert.equal(element.style.top, "25px");
    assert.equal(element.style.width, "100px");
    assert.equal(element.style.height, "30px");
});

test("an element starts parked at the base style until the first sync", () => {
    const element = stubElement();
    new DomOverlay(element);
    assert.equal(element.style.position, "fixed");
    assert.equal(element.style.left, "0px");
    assert.equal(element.style.width, "1px");
});

test("the caller's styles layer over the base", () => {
    const element = stubElement();
    new DomOverlay(element, {overflow: "hidden", position: "absolute"});
    assert.equal(element.style.overflow, "hidden");
    assert.equal(element.style.position, "absolute");
});

test("a collapsed display object still gets a 1px rect, so it stays hittable", () => {
    const element = stubElement();
    new DomOverlay(element).sync(bounds(10, 5, 0, 0), CANVAS_RECT);
    assert.equal(element.style.width, "1px");
    assert.equal(element.style.height, "1px");
});

test("re-syncing the same rect reports no move and writes nothing", () => {
    const element = stubElement();
    const overlay = new DomOverlay(element);
    assert.equal(overlay.sync(bounds(10, 5, 100, 30), CANVAS_RECT), true);
    element.style.left = "stale";
    assert.equal(overlay.sync(bounds(10, 5, 100, 30), CANVAS_RECT), false);
    assert.equal(element.style.left, "stale");
});

test("a move in any one dimension re-writes the rect", () => {
    const element = stubElement();
    const overlay = new DomOverlay(element);
    overlay.sync(bounds(10, 5, 100, 30), CANVAS_RECT);
    assert.equal(overlay.sync(bounds(10, 5, 100, 31), CANVAS_RECT), true);
    assert.equal(element.style.height, "31px");
});

test("the canvas scrolling under a still display object moves the overlay with it", () => {
    const element = stubElement();
    const overlay = new DomOverlay(element);
    overlay.sync(bounds(10, 5, 100, 30), CANVAS_RECT);
    assert.equal(overlay.sync(bounds(10, 5, 100, 30), {left: 40, top: 0}), true);
    assert.equal(element.style.top, "5px");
});

test("invalidating makes the next sync write the same rect again", () => {
    const element = stubElement();
    const overlay = new DomOverlay(element);
    overlay.sync(bounds(10, 5, 100, 30), CANVAS_RECT);
    overlay.invalidate();
    assert.equal(overlay.sync(bounds(10, 5, 100, 30), CANVAS_RECT), true);
});

test("removing takes the element out of the document", () => {
    const element = stubElement();
    new DomOverlay(element).remove();
    assert.equal(element.removed, true);
});
