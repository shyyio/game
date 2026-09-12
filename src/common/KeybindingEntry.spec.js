import {test} from "node:test";
import assert from "node:assert/strict";
import {KeybindingEntry, CORE_KEYBINDING_ENTRIES} from "@/common/KeybindingEntry.js";
import {getBindableKeyValueByKeyOrNull} from "@/common/bindableKeys.js";

const MOD_KEY = 900;

test("an entry carries its default as a stored value", () => {
    const entry = new KeybindingEntry(MOD_KEY, "Pan up", "w");
    assert.equal(entry.playerSettingKey, MOD_KEY);
    assert.equal(entry.label, "Pan up");
    assert.equal(entry.defaultValue, getBindableKeyValueByKeyOrNull("w"));
});

test("a default no binding may hold throws", () => {
    assert.throws(() => new KeybindingEntry(MOD_KEY, "Pan up", "Meta"), /No bindable key "Meta"/);
});

test("core entries hold unique player setting keys", () => {
    const keys = CORE_KEYBINDING_ENTRIES.map(entry => entry.playerSettingKey);
    assert.equal(new Set(keys).size, keys.length);
});
