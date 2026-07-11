import {test} from "node:test";
import assert from "node:assert/strict";
import {SessionRegistry} from "@/common/SessionRegistry.js";

test("setViewport reports the added/removed chunk delta", () => {
    const registry = new SessionRegistry();
    registry.add(1);

    assert.deepEqual(registry.setViewport(1, [10, 11, 12]), {added: [10, 11, 12], removed: []});
    // Pan: 10 drops out, 13 enters; 11, 12 unchanged.
    const delta = registry.setViewport(1, [11, 12, 13]);
    assert.deepEqual(delta.added, [13]);
    assert.deepEqual(delta.removed, [10]);
});

test("sessionsForChunk returns every session covering a chunk", () => {
    const registry = new SessionRegistry();
    registry.add(1);
    registry.add(2);
    registry.setViewport(1, [10, 11]);
    registry.setViewport(2, [11, 12]);

    assert.deepEqual(registry.sessionsForChunk(11).sort(), [1, 2]);
    assert.deepEqual(registry.sessionsForChunk(10), [1]);
    assert.deepEqual(registry.sessionsForChunk(99), []);
    assert.equal(registry.covers(1, 10), true);
    assert.equal(registry.covers(2, 10), false);
});

test("remove drops a session from routing", () => {
    const registry = new SessionRegistry();
    registry.add(1);
    registry.setViewport(1, [10]);
    registry.remove(1);

    assert.deepEqual(registry.sessionsForChunk(10), []);
    assert.equal(registry.covers(1, 10), false);
});
