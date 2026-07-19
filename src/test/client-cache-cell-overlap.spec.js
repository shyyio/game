import {test} from "node:test";
import assert from "node:assert/strict";
import {LAYER_SURFACE} from "@/common/constants.js";
import {ClientCache} from "@/client/ClientCache.js";

const WATER_ID = 1;
const EXTRACTOR_ID = 2;

function cacheWithWater() {
    const cache = new ClientCache();
    cache.set(WATER_ID, 5, 5, [{x: 5, y: 5, layer: LAYER_SURFACE}]);
    return cache;
}

test("a later entry on the same cell covers the earlier one", () => {
    const cache = cacheWithWater();
    cache.set(EXTRACTOR_ID, 5, 5, [{x: 5, y: 5, layer: LAYER_SURFACE}]);
    assert.equal(cache.at(5, 5, LAYER_SURFACE).id, EXTRACTOR_ID);
});

test("removing the covering entry uncovers the one beneath", () => {
    const cache = cacheWithWater();
    cache.set(EXTRACTOR_ID, 5, 5, [{x: 5, y: 5, layer: LAYER_SURFACE}]);
    cache.remove(EXTRACTOR_ID);
    assert.equal(cache.at(5, 5, LAYER_SURFACE).id, WATER_ID);
});

test("removing the buried entry keeps the covering one", () => {
    const cache = cacheWithWater();
    cache.set(EXTRACTOR_ID, 5, 5, [{x: 5, y: 5, layer: LAYER_SURFACE}]);
    cache.remove(WATER_ID);
    assert.equal(cache.at(5, 5, LAYER_SURFACE).id, EXTRACTOR_ID);
    cache.remove(EXTRACTOR_ID);
    assert.equal(cache.at(5, 5, LAYER_SURFACE), null);
});
