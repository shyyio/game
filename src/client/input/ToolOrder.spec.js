import {test} from "node:test";
import assert from "node:assert/strict";
import {applyToolOrder} from "@/client/input/ToolOrder.js";

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
