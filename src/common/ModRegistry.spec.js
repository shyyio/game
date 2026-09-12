import {test} from "node:test";
import assert from "node:assert/strict";
import {ModRegistry} from "@/common/ModRegistry.js";
import {ModPackage} from "@/common/ModPackage.js";
import {AbstractModDeclaration} from "@/common/AbstractModDeclaration.js";
import {PlayerSettingEntry} from "@/common/PlayerSettingEntry.js";
import {KeybindingEntry, CORE_KEYBINDING_ENTRIES} from "@/common/KeybindingEntry.js";
import {BINDABLE_KEYS} from "@/common/bindableKeys.js";
import {ItemType} from "@/common/ItemType.js";
import {ItemCategory} from "@/common/ItemCategory.js";
import {ObjectType, PlacementRule} from "@/common/ObjectType.js";
import {StaticBehavior} from "@/common/behaviors/StaticBehavior.js";

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
    assert.equal(registry.getPlayerSettingEntryByKeyOrNull(MOD_KEY).isClientWritable, false);
    assert.equal(registry.getPlayerSettingEntryByKeyOrNull(999), null);
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
    assert.throws(() => registry.getPlayerSettingEntryByKeyOrNull(MOD_KEY), /not frozen/);
});

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

test("a mod's item types collect into the item registry at freeze", () => {
    const registry = new ModRegistry();
    const fluids = new ItemCategory("Fluids", {[MOD_ITEM_TYPE]: new ItemType("Water", "items/1-gray")});
    registry.register(new ModPackage(new ItemsDeclaration("A", [fluids])));
    registry.freeze();
    assert.equal(registry.items.getItemTypeByTypeId(MOD_ITEM_TYPE).name, "Water");
});

test("a duplicate item type across mods throws at freeze", () => {
    const registry = new ModRegistry();
    const water = new ItemCategory("Fluids", {[MOD_ITEM_TYPE]: new ItemType("Water", "items/1-gray")});
    const brine = new ItemCategory("Fluids", {[MOD_ITEM_TYPE]: new ItemType("Brine", "items/2-gray")});
    registry.register(new ModPackage(new ItemsDeclaration("A", [water])));
    registry.register(new ModPackage(new ItemsDeclaration("B", [brine])));
    assert.throws(() => registry.freeze(), /Duplicate item type/);
});

test("same-name item categories across mods merge, sorted by name", () => {
    const registry = new ModRegistry();
    const water = new ItemType("Water", "items/1-gray");
    const brine = new ItemType("Brine", "items/2-gray");
    const iron = new ItemType("Iron", "items/3-gray");
    registry.register(new ModPackage(new ItemsDeclaration("A", [
        new ItemCategory("Ores", {[MOD_ITEM_TYPE + 2]: iron}),
        new ItemCategory("Fluids", {[MOD_ITEM_TYPE]: water}),
    ])));
    registry.register(new ModPackage(new ItemsDeclaration("B", [
        new ItemCategory("Fluids", {[MOD_ITEM_TYPE + 1]: brine}),
    ])));
    registry.freeze();
    assert.deepEqual(registry.itemCategories, [
        new ItemCategory("Fluids", {[MOD_ITEM_TYPE]: water, [MOD_ITEM_TYPE + 1]: brine}),
        new ItemCategory("Ores", {[MOD_ITEM_TYPE + 2]: iron}),
    ]);
});

/**
 * @param {string} name
 * @returns {ObjectType}
 */
function objectType(name) {
    return new ObjectType({
        name,
        geometry: "1x1",
        textureName: "demo-machine/0",
        label: name,
        placement: new PlacementRule({}),
        behavior: new StaticBehavior(),
    });
}

class TypesDeclaration extends AbstractModDeclaration {

    /**
     * @param {string} name
     * @param {ObjectType[]} types
     */
    constructor(name, types) {
        super();
        this._name = name;
        this._types = types;
    }

    get name() {
        return this._name;
    }

    get objectTypes() {
        return this._types;
    }
}

/**
 * @param {Array<[string, ObjectType[]]>} mods
 * @returns {ModRegistry}
 */
function frozen(mods) {
    const registry = new ModRegistry();
    for (const [name, types] of mods) {
        registry.register(new ModPackage(new TypesDeclaration(name, types)));
    }
    registry.freeze();
    return registry;
}

test("a loadout that drops a mod renumbers the object types it keeps", () => {
    const first = objectType("First");
    const second = objectType("Second");
    frozen([["A", [first]], ["B", [second]]]);
    assert.deepEqual([first.objectTypeId, second.objectTypeId], [0, 1]);

    frozen([["B", [second]]]);
    assert.equal(second.objectTypeId, 0);
});

test("a registry takes its own objectTypeIds back after another loadout froze over them", () => {
    const first = objectType("Third");
    const second = objectType("Fourth");
    const registry = frozen([["A", [first]], ["B", [second]]]);
    frozen([["B", [second]]]);

    registry.claimTypeIds();
    assert.deepEqual([first.objectTypeId, second.objectTypeId], [0, 1]);
});

class KeybindingDeclaration extends AbstractModDeclaration {

    /**
     * @param {string} name
     * @param {KeybindingEntry[]} entries
     */
    constructor(name, entries) {
        super();
        this._name = name;
        this._entries = entries;
    }

    get name() {
        return this._name;
    }

    get keybindingEntries() {
        return this._entries;
    }
}

test("a keybinding registers a client-writable player setting over the bindable keys", () => {
    const registry = new ModRegistry();
    registry.register(new ModPackage(new KeybindingDeclaration("A", [new KeybindingEntry(MOD_KEY, "Raise", "w")])));
    registry.freeze();
    const entry = registry.getPlayerSettingEntryByKeyOrNull(MOD_KEY);
    assert.equal(entry.isClientWritable, true);
    assert.equal(entry.optionCount, BINDABLE_KEYS.length);
});

test("core keybindings are collected at freeze", () => {
    const registry = new ModRegistry();
    registry.freeze();
    assert.deepEqual(registry.keybindingEntries.slice(0, CORE_KEYBINDING_ENTRIES.length), CORE_KEYBINDING_ENTRIES);
});

test("a mod's keybindings follow the core ones", () => {
    const registry = new ModRegistry();
    const entry = new KeybindingEntry(MOD_KEY, "Raise", "w");
    registry.register(new ModPackage(new KeybindingDeclaration("A", [entry])));
    registry.freeze();
    assert.equal(registry.keybindingEntries.at(-1), entry);
});

test("a keybinding colliding with a player setting key throws at freeze", () => {
    const registry = new ModRegistry();
    registry.register(new ModPackage(new EntriesDeclaration("A", [new PlayerSettingEntry(MOD_KEY, true, 2)])));
    registry.register(new ModPackage(new KeybindingDeclaration("B", [new KeybindingEntry(MOD_KEY, "Raise", "w")])));
    assert.throws(() => registry.freeze(), /Duplicate player setting key/);
});

test("a keybinding is found by the player setting key it stores", () => {
    const registry = new ModRegistry();
    const entry = new KeybindingEntry(MOD_KEY, "Raise", "w");
    registry.register(new ModPackage(new KeybindingDeclaration("A", [entry])));
    registry.freeze();
    assert.equal(registry.getKeybindingEntryByPlayerSettingKeyOrNull(MOD_KEY), entry);
    assert.equal(registry.getKeybindingEntryByPlayerSettingKeyOrNull(MOD_KEY + 1), null);
});
