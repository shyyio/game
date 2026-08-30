import {test} from "node:test";
import assert from "node:assert/strict";
import {ToolReorderDrag} from "@/client/hud/ToolReorderDrag.js";

const ICON_BASE_SCALE = 2;
// Past any lift duration, so the tween has settled.
const SETTLED_MS = 10000;

/**
 * A stand-in for the detached icon sprite, recording what the drag does to it.
 * @returns {object}
 */
function stubIcon() {
    return {
        scale: {x: ICON_BASE_SCALE, set(value) {
            this.x = value;
        }},
        destroyed: false,
        destroy() {
            this.destroyed = true;
        },
    };
}

/**
 * A drag of `order[1]` over a three-tool order.
 * @param {object} [icon]
 * @param {function(): void} [detachTracking]
 * @returns {{drag: ToolReorderDrag, order: string[]}}
 */
function build(icon = stubIcon(), detachTracking = () => {}) {
    const order = ["a", "b", "c"];
    return {drag: new ToolReorderDrag(order[1], icon, order, detachTracking), order};
}

test("the working order starts as a copy, leaving the picked-up order untouched", () => {
    const {drag, order} = build();
    drag.moveTo(0);
    assert.deepEqual(drag.order, ["b", "a", "c"]);
    assert.deepEqual(order, ["a", "b", "c"]);
});

test("a move to the tool's current index changes nothing", () => {
    const {drag} = build();
    assert.equal(drag.moveTo(1), false);
    assert.deepEqual(drag.order, ["a", "b", "c"]);
});

test("a move to another index reports the change", () => {
    const {drag} = build();
    assert.equal(drag.moveTo(2), true);
    assert.deepEqual(drag.order, ["a", "c", "b"]);
});

test("a drag reports reordered only once the tool has left its start index", () => {
    const {drag} = build();
    assert.equal(drag.reordered, false);
    drag.moveTo(2);
    assert.equal(drag.reordered, true);
});

test("a drag moved back to where it started is not a reorder", () => {
    const {drag} = build();
    drag.moveTo(2);
    drag.moveTo(1);
    assert.equal(drag.reordered, false);
});

test("a move past the end of the order throws", () => {
    const {drag} = build();
    assert.throws(() => drag.moveTo(3));
});

test("the lift grows the icon from its base scale", () => {
    const icon = stubIcon();
    const {drag} = build(icon);
    drag.advanceLift(0);
    assert.equal(icon.scale.x, ICON_BASE_SCALE);
    drag.advanceLift(SETTLED_MS);
    assert.ok(icon.scale.x > ICON_BASE_SCALE);
});

test("settling returns the icon to its base scale", () => {
    const icon = stubIcon();
    const {drag} = build(icon);
    drag.advanceLift(SETTLED_MS);
    drag.settleIcon();
    assert.equal(icon.scale.x, ICON_BASE_SCALE);
});

test("canceling releases the pointer tracking and destroys the lifted icon", () => {
    const icon = stubIcon();
    let detached = false;
    const {drag} = build(icon, () => {
        detached = true;
    });
    drag.cancel();
    assert.equal(detached, true);
    assert.equal(icon.destroyed, true);
});
