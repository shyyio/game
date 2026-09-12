import {test} from "node:test";
import assert from "node:assert/strict";
import {BINDABLE_KEYS, BINDABLE_KEY_UNBOUND, getBindableKeyByValue, getBindableKeyValueByKeyOrNull} from "@/common/bindableKeys.js";

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
