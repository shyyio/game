import {test} from "node:test";
import assert from "node:assert/strict";
import {ModRegistry} from "@/common/ModRegistry.js";
import {ModPackage} from "@/common/ModPackage.js";
import {AbstractModDeclaration} from "@/common/AbstractModDeclaration.js";
import {PlayerSettingEntry} from "@/common/PlayerSettingEntry.js";
import {ItemDefinition} from "@/common/ItemDefinition.js";

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

test("the entry accessor throws before freeze", () => {
    const registry = new ModRegistry();
    assert.throws(() => registry.playerSettingEntry(MOD_KEY), /not frozen/);
});

class ItemsDeclaration extends AbstractModDeclaration {

    /**
     * @param {string} name
     * @param {Object.<number, ItemDefinition>} items
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
    registry.register(new ModPackage(new ItemsDeclaration("A", {[MOD_ITEM_TYPE]: new ItemDefinition("Water", "items/1-gray")})));
    registry.freeze();
    assert.equal(registry.items.require(MOD_ITEM_TYPE).name, "Water");
});

test("a duplicate item type across mods throws at freeze", () => {
    const registry = new ModRegistry();
    registry.register(new ModPackage(new ItemsDeclaration("A", {[MOD_ITEM_TYPE]: new ItemDefinition("Water", "items/1-gray")})));
    registry.register(new ModPackage(new ItemsDeclaration("B", {[MOD_ITEM_TYPE]: new ItemDefinition("Brine", "items/2-gray")})));
    assert.throws(() => registry.freeze(), /Duplicate item definition/);
});
