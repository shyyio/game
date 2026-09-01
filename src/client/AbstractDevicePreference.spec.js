import {test} from "node:test";
import assert from "node:assert/strict";
import {AbstractDevicePreference} from "@/client/AbstractDevicePreference.js";
import {NotImplementedError} from "@/common/error.js";

class TestPreference extends AbstractDevicePreference {

    devicePrefers() {
        return true;
    }
}

test("setEnabled stores the value and tells every subscriber", () => {
    const preference = new TestPreference();
    const seen = [];
    preference.onChange(on => seen.push(`first:${on}`));
    preference.onChange(on => seen.push(`second:${on}`));

    preference.setEnabled(true);

    assert.equal(preference.enabled, true);
    assert.deepEqual(seen, ["first:true", "second:true"]);
});

test("unsubscribing drops only that subscriber", () => {
    const preference = new TestPreference();
    const seen = [];
    const stop = preference.onChange(on => seen.push(`first:${on}`));
    preference.onChange(on => seen.push(`second:${on}`));

    stop();
    preference.setEnabled(true);

    assert.deepEqual(seen, ["second:true"]);
});

test("a preference that does not answer devicePrefers breaks loudly", () => {
    assert.throws(() => new AbstractDevicePreference().devicePrefers(), NotImplementedError);
});
