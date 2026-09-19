import {test} from "node:test";
import assert from "node:assert/strict";
import {productBadgeFootprintTiles, productBadgeScale} from "@/client/layers/ProductBadgeLayer.js";

test("a badge grows with its footprint, and map mode draws it bigger still", () => {
    assert.equal(productBadgeScale(false, 1), 1);
    assert.equal(productBadgeScale(false, 2), 1.5);
    assert.equal(productBadgeScale(false, 3), 2);
    assert.equal(productBadgeScale(true, 1), 1.3);
    assert.equal(productBadgeScale(true, 2), 2);
    assert.equal(productBadgeScale(true, 3), 3);
});

test("a footprint longer than the table draws at its largest size", () => {
    assert.equal(productBadgeScale(false, 9), productBadgeScale(false, 3));
    assert.equal(productBadgeScale(true, 9), productBadgeScale(true, 3));
});

test("a footprint measures by its longest side", () => {
    assert.equal(productBadgeFootprintTiles({minTileX: 4, minTileY: 4, maxTileX: 4, maxTileY: 4}), 1);
    assert.equal(productBadgeFootprintTiles({minTileX: 4, minTileY: 4, maxTileX: 4, maxTileY: 5}), 2);
    assert.equal(productBadgeFootprintTiles({minTileX: 4, minTileY: 4, maxTileX: 5, maxTileY: 5}), 2);
    assert.equal(productBadgeFootprintTiles({minTileX: 4, minTileY: 4, maxTileX: 6, maxTileY: 6}), 3);
});
