import {test} from "node:test";
import assert from "node:assert/strict";
import {applyToolOrder, moveWithin} from "@/client/input/ToolOrder.js";

function tool(id) {
    return {id};
}

test("applyToolOrder sorts known tools by their stored position", () => {
    const tools = [tool(1), tool(2), tool(3)];
    const orderedIds = [3, 1, 2];
    const result = applyToolOrder(tools, orderedIds);
    assert.deepEqual(result.map(t => t.id), [3, 1, 2]);
});

test("applyToolOrder appends unseen tools at the end in default order", () => {
    const tools = [tool(1), tool(2), tool(3)];
    const orderedIds = [3];
    const result = applyToolOrder(tools, orderedIds);
    assert.deepEqual(result.map(t => t.id), [3, 1, 2]);
});

test("applyToolOrder ignores stale/unknown ids", () => {
    const tools = [tool(1), tool(2)];
    const orderedIds = [999999, 2, 1];
    const result = applyToolOrder(tools, orderedIds);
    assert.deepEqual(result.map(t => t.id), [2, 1]);
});

test("applyToolOrder throws on a tool id collision", () => {
    const colliding = tool(1);
    // Force a collision by giving both tools the same id.
    const tools = [colliding, tool(1)];
    assert.throws(() => applyToolOrder(tools, []));
});

test("moveWithin drags an item later, closing the gap behind it", () => {
    const first = tool(1);
    const order = [first, tool(2), tool(3)];
    moveWithin(order, first, 2);
    assert.deepEqual(order.map(t => t.id), [2, 3, 1]);
});

test("moveWithin drags an item earlier", () => {
    const last = tool(3);
    const order = [tool(1), tool(2), last];
    moveWithin(order, last, 0);
    assert.deepEqual(order.map(t => t.id), [3, 1, 2]);
});

test("moveWithin to an item's own index leaves the order alone", () => {
    const middle = tool(2);
    const order = [tool(1), middle, tool(3)];
    moveWithin(order, middle, 1);
    assert.deepEqual(order.map(t => t.id), [1, 2, 3]);
});

test("moveWithin throws on an item outside the order, or a target outside it", () => {
    const order = [tool(1), tool(2)];
    assert.throws(() => moveWithin(order, tool(9), 0));
    assert.throws(() => moveWithin(order, order[0], 2));
});
