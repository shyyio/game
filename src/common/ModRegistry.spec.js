import {test} from "node:test";
import assert from "node:assert/strict";
import {ModRegistry} from "@/common/ModRegistry.js";
import {ModPackage} from "@/common/ModPackage.js";
import {AbstractModDeclaration} from "@/common/AbstractModDeclaration.js";
import {PlayerSettingEntry} from "@/common/PlayerSettingEntry.js";
import {ItemDefinition} from "@/common/ItemDefinition.js";
import {ItemCategory} from "@/common/ItemCategory.js";

const MOD_KEY = 900;
const MOD_ITEM_TYPE = 910;

class EntriesDeclaration extends AbstractModDeclaration {

    /**
     * @param {string} name
     * @param {PlayerSettingEntry[]} entries
     */
    constructor(name, entries) {
        super();
        this._name = name;
        this._entries = entries;
    }

    get name() {
        return this._name;
    }

    get playerSettingEntries() {
        return this._entries;
    }
}

test("a mod's player-setting entries collect at freeze", () => {
    const registry = new ModRegistry();
    registry.register(new ModPackage(new EntriesDeclaration("A", [new PlayerSettingEntry(MOD_KEY, false, 2)])));
    registry.freeze();
    assert.equal(registry.playerSettingEntry(MOD_KEY).clientWritable, false);
    assert.equal(registry.playerSettingEntry(999), undefined);
});

test("a duplicate key across mods throws at freeze", () => {
    const registry = new ModRegistry();
    registry.register(new ModPackage(new EntriesDeclaration("A", [new PlayerSettingEntry(MOD_KEY, true, 2)])));
    registry.register(new ModPackage(new EntriesDeclaration("B", [new PlayerSettingEntry(MOD_KEY, false, 2)])));
    assert.throws(() => registry.freeze(), /Duplicate player setting key/);
});

test("the same mod registered twice throws at freeze, naming it", () => {
    const registry = new ModRegistry();
    registry.register(new ModPackage(new EntriesDeclaration("A", [new PlayerSettingEntry(MOD_KEY, true, 2)])));
    registry.register(new ModPackage(new EntriesDeclaration("A", [new PlayerSettingEntry(MOD_KEY, true, 2)])));
    assert.throws(() => registry.freeze(), /Mod "A" is in this loadout twice/);
});

test("the entry accessor throws before freeze", () => {
    const registry = new ModRegistry();
    assert.throws(() => registry.playerSettingEntry(MOD_KEY), /not frozen/);
});

const FLUIDS_ORDER = 5;
const ORES_ORDER = 10;

class ItemsDeclaration extends AbstractModDeclaration {

    /**
     * @param {string} name
     * @param {ItemCategory[]} items
     */
    constructor(name, items) {
        super();
        this._name = name;
        this._items = items;
    }

    get name() {
        return this._name;
    }

    get items() {
        return this._items;
    }
}

test("a mod's item definitions collect into the item registry at freeze", () => {
    const registry = new ModRegistry();
    const fluids = new ItemCategory("Fluids", FLUIDS_ORDER, {[MOD_ITEM_TYPE]: new ItemDefinition("Water", "items/1-gray")});
    registry.register(new ModPackage(new ItemsDeclaration("A", [fluids])));
    registry.freeze();
    assert.equal(registry.items.require(MOD_ITEM_TYPE).name, "Water");
});

test("a duplicate item type across mods throws at freeze", () => {
    const registry = new ModRegistry();
    const water = new ItemCategory("Fluids", FLUIDS_ORDER, {[MOD_ITEM_TYPE]: new ItemDefinition("Water", "items/1-gray")});
    const brine = new ItemCategory("Fluids", FLUIDS_ORDER, {[MOD_ITEM_TYPE]: new ItemDefinition("Brine", "items/2-gray")});
    registry.register(new ModPackage(new ItemsDeclaration("A", [water])));
    registry.register(new ModPackage(new ItemsDeclaration("B", [brine])));
    assert.throws(() => registry.freeze(), /Duplicate item definition/);
});

test("same-name item categories across mods merge, sorted by display order", () => {
    const registry = new ModRegistry();
    const water = new ItemDefinition("Water", "items/1-gray");
    const brine = new ItemDefinition("Brine", "items/2-gray");
    const iron = new ItemDefinition("Iron", "items/3-gray");
    registry.register(new ModPackage(new ItemsDeclaration("A", [
        new ItemCategory("Ores", ORES_ORDER, {[MOD_ITEM_TYPE + 2]: iron}),
        new ItemCategory("Fluids", FLUIDS_ORDER, {[MOD_ITEM_TYPE]: water}),
    ])));
    registry.register(new ModPackage(new ItemsDeclaration("B", [
        new ItemCategory("Fluids", FLUIDS_ORDER, {[MOD_ITEM_TYPE + 1]: brine}),
    ])));
    registry.freeze();
    assert.deepEqual(registry.itemCategories, [
        new ItemCategory("Fluids", FLUIDS_ORDER, {[MOD_ITEM_TYPE]: water, [MOD_ITEM_TYPE + 1]: brine}),
        new ItemCategory("Ores", ORES_ORDER, {[MOD_ITEM_TYPE + 2]: iron}),
    ]);
});

test("an item category declared with two display orders throws at freeze", () => {
    const registry = new ModRegistry();
    registry.register(new ModPackage(new ItemsDeclaration("A", [new ItemCategory("Fluids", FLUIDS_ORDER, {})])));
    registry.register(new ModPackage(new ItemsDeclaration("B", [new ItemCategory("Fluids", ORES_ORDER, {})])));
    assert.throws(() => registry.freeze(), /Item category "Fluids" declared with displayOrder/);
});
