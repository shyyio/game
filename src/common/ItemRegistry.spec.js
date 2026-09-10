import {test} from "node:test";
import assert from "node:assert/strict";
import {ItemRegistry} from "@/common/ItemRegistry.js";
import {ItemType} from "@/common/ItemType.js";


test("getItemTypeByTypeId returns a registered definition and throws on an unknown type", () => {
    const registry = new ItemRegistry();
    registry.register(310, new ItemType("Water", "items/1-gray"));
    assert.equal(registry.getItemTypeByTypeId(310).name, "Water");
    assert.throws(() => registry.getItemTypeByTypeId(311), /Unknown item type 311/);
});

test("findItemTypeByTypeId tolerates an unknown type", () => {
    const registry = new ItemRegistry();
    assert.equal(registry.findItemTypeByTypeId(310), undefined);
});

test("a duplicate item type throws", () => {
    const registry = new ItemRegistry();
    registry.register(310, new ItemType("Water", "items/1-gray"));
    assert.throws(() => registry.register(310, new ItemType("Brine", "items/2-gray")), /Duplicate item type/);
});
