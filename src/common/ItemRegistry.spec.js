import {test} from "node:test";
import assert from "node:assert/strict";
import {ItemRegistry} from "@/common/ItemRegistry.js";
import {ItemDefinition} from "@/common/ItemDefinition.js";


test("require returns a registered definition and throws on an unknown type", () => {
    const registry = new ItemRegistry();
    registry.register(310, new ItemDefinition("Water", "items/1-gray"));
    assert.equal(registry.require(310).name, "Water");
    assert.throws(() => registry.require(311), /Unknown item type 311/);
});

test("get tolerates an unknown type", () => {
    const registry = new ItemRegistry();
    assert.equal(registry.get(310), undefined);
});

test("a duplicate item type throws", () => {
    const registry = new ItemRegistry();
    registry.register(310, new ItemDefinition("Water", "items/1-gray"));
    assert.throws(() => registry.register(310, new ItemDefinition("Brine", "items/2-gray")), /Duplicate item definition/);
});
