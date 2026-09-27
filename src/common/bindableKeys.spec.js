import {test} from "node:test";
import assert from "node:assert/strict";
import {BINDABLE_KEYS, BINDABLE_KEY_UNBOUND, getBindableKeyByValue, getBindableKeyValueByKeyOrNull, getKeyNameByEvent} from "@/common/bindableKeys.js";

test("the unbound value resolves to the empty key", () => {
    assert.equal(getBindableKeyByValue(BINDABLE_KEY_UNBOUND), "");
});

test("every listed key round-trips through its value", () => {
    for (const key of BINDABLE_KEYS) {
        assert.equal(getBindableKeyByValue(getBindableKeyValueByKeyOrNull(key)), key);
    }
});

test("a key outside the table has no value", () => {
    assert.equal(getBindableKeyValueByKeyOrNull("Meta"), null);
});

test("a value outside the table throws", () => {
    assert.throws(() => getBindableKeyByValue(BINDABLE_KEYS.length), /No bindable key/);
});

test("a Ctrl combo on a letter is bindable", () => {
    assert.notEqual(getBindableKeyValueByKeyOrNull("Ctrl+c"), null);
    assert.notEqual(getBindableKeyValueByKeyOrNull("Ctrl+z"), null);
});

test("a key event names itself, prefixed Ctrl+ while Ctrl or Meta is held", () => {
    assert.equal(getKeyNameByEvent({key: "c", ctrlKey: false, metaKey: false}), "c");
    assert.equal(getKeyNameByEvent({key: "c", ctrlKey: true, metaKey: false}), "Ctrl+c");
    assert.equal(getKeyNameByEvent({key: "v", ctrlKey: false, metaKey: true}), "Ctrl+v");
    assert.equal(getKeyNameByEvent({key: "Control", ctrlKey: true, metaKey: false}), "Control");
});
