import {test} from "node:test";
import assert from "node:assert/strict";
import {ModRegistry} from "@/common/ModRegistry.js";
import {ModPackage} from "@/common/ModPackage.js";
import {AbstractModDeclaration} from "@/common/AbstractModDeclaration.js";
import {PlayerSettingEntry} from "@/common/PlayerSettingEntry.js";

const MOD_KEY = 900;

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
    registry.register(new ModPackage(new EntriesDeclaration("A", [new PlayerSettingEntry(MOD_KEY, false)])));
    registry.freeze();
    assert.equal(registry.playerSettingEntry(MOD_KEY).clientWritable, false);
    assert.equal(registry.playerSettingEntry(999), undefined);
});

test("a duplicate key across mods throws at freeze", () => {
    const registry = new ModRegistry();
    registry.register(new ModPackage(new EntriesDeclaration("A", [new PlayerSettingEntry(MOD_KEY, true)])));
    registry.register(new ModPackage(new EntriesDeclaration("B", [new PlayerSettingEntry(MOD_KEY, false)])));
    assert.throws(() => registry.freeze(), /Duplicate player setting key/);
});

test("the entry accessor throws before freeze", () => {
    const registry = new ModRegistry();
    assert.throws(() => registry.playerSettingEntry(MOD_KEY), /not frozen/);
});
