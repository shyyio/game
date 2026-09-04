import {test} from "node:test";
import assert from "node:assert/strict";
import {EMPTY} from "@spup/sdk";
import {withoutEmptied} from "./Belts.js";

/**
 * @param {number} type
 * @param {number} gap
 * @returns {object}
 */
function item(type, gap) {
    return {id: type, type, gap};
}

test("an emptied item's cell folds into the gap of the item behind it", () => {
    const {items, freed} = withoutEmptied([item(1, 0), item(EMPTY, 2), item(3, 1)]);
    assert.deepEqual(items, [item(1, 0), {id: 3, type: 3, gap: 4}]);
    assert.equal(freed, 0);
});

test("what the input-edge-most emptied items free is reported, not dropped", () => {
    const {items, freed} = withoutEmptied([item(1, 0), item(EMPTY, 2), item(EMPTY, 0)]);
    assert.deepEqual(items, [item(1, 0)]);
    assert.equal(freed, 4, "two cells plus the two half-tiles between them");
});
