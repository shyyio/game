import {test} from "node:test";
import assert from "node:assert/strict";
import {FrozenSet} from "@/common/FrozenSet.js";

test("a FrozenSet reads its set and offers no way to change it", () => {
    const set = new Set([1, 2]);
    const frozen = new FrozenSet(set);
    assert.equal(frozen.size, 2);
    assert.equal(frozen.has(1), true);
    assert.equal(frozen.has(3), false);
    assert.deepEqual(Array.from(frozen), [1, 2]);
    assert.equal(frozen.add, undefined);
    assert.equal(frozen.delete, undefined);
    assert.equal(frozen.clear, undefined);
});
