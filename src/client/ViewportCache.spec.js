import {test} from "node:test";
import assert from "node:assert";

import {ViewportCache} from "@/client/ViewportCache.js";
import {chunkKey} from "@/common/util.js";

test("insert then get returns the record with derived chunk", () => {
    const cache = new ViewportCache();
    cache.insert(1n, 3, 4, {type: 0});

    const record = cache.get(1n);
    assert.strictEqual(record.id, 1n);
    assert.strictEqual(record.tileX, 3);
    assert.strictEqual(record.tileY, 4);
    assert.strictEqual(record.chunk, chunkKey(3, 4));
    assert.deepStrictEqual(record.data, {type: 0});
});

test("getAtTile returns every object on a tile", () => {
    const cache = new ViewportCache();
    cache.insert(1n, 5, 5, {type: 0});
    cache.insert(2n, 5, 5, {type: 3});

    const records = cache.getAtTile(5, 5);
    assert.strictEqual(records.length, 2);
    assert.deepStrictEqual(records.map(record => record.id).sort(), [1n, 2n]);
    assert.deepStrictEqual(cache.getAtTile(9, 9), []);
});

test("update merges into a record's data", () => {
    const cache = new ViewportCache();
    cache.insert(1n, 0, 0, {parentX: null, parentY: null});
    cache.update(1n, {parentX: 1, parentY: 0});

    assert.deepStrictEqual(cache.get(1n).data, {parentX: 1, parentY: 0});
    // No-op for unknown ids.
    cache.update(99n, {parentX: 2});
    assert.strictEqual(cache.get(99n), null);
});

test("remove clears all indexes and returns the record", () => {
    const cache = new ViewportCache();
    cache.insert(1n, 7, 8, {type: 0});

    const removed = cache.remove(1n);
    assert.strictEqual(removed.id, 1n);
    assert.strictEqual(cache.get(1n), null);
    assert.deepStrictEqual(cache.getAtTile(7, 8), []);
    assert.deepStrictEqual(cache.getByChunk(chunkKey(7, 8)), []);
    assert.strictEqual(cache.remove(1n), null);
});

test("getByChunk returns objects grouped by chunk", () => {
    const cache = new ViewportCache();
    cache.insert(1n, 1, 1, {type: 0});
    cache.insert(2n, 2, 2, {type: 0});
    cache.insert(3n, 200, 200, {type: 0});

    const near = cache.getByChunk(chunkKey(1, 1));
    assert.strictEqual(near.length, 2);
    assert.deepStrictEqual(near.map(record => record.id).sort(), [1n, 2n]);
    assert.strictEqual(cache.getByChunk(chunkKey(200, 200)).length, 1);
});

test("clearChunk drops the chunk's records and returns their ids", () => {
    const cache = new ViewportCache();
    cache.insert(1n, 1, 1, {type: 0});
    cache.insert(2n, 2, 2, {type: 0});
    cache.insert(3n, 200, 200, {type: 0});

    const cleared = cache.clearChunk(chunkKey(1, 1));
    assert.deepStrictEqual(cleared.slice().sort(), [1n, 2n]);
    assert.strictEqual(cache.get(1n), null);
    assert.strictEqual(cache.get(2n), null);
    // Other chunks are untouched.
    assert.strictEqual(cache.get(3n).id, 3n);
    assert.deepStrictEqual(cache.clearChunk(chunkKey(1, 1)), []);
});
