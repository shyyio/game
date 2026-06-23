import {test} from "node:test";
import assert from "node:assert";

import {AbstractMessage} from "@/common/AbstractMessage.js";
import {SetViewportMessage} from "@/common/CoreMessages.js";

class ValidMessage extends AbstractMessage {

    static wireFields = {
        value: "int32",
    };
}

class MissingFieldsMessage extends AbstractMessage {

}

test("A subclass that declares wireFields constructs", () => {
    assert.doesNotThrow(() => new ValidMessage());
});

test("A subclass without wireFields throws on construction", () => {
    assert.throws(() => new MissingFieldsMessage(), /MissingFieldsMessage.*wireFields/);
});

test("Instantiating the base AbstractMessage directly throws", () => {
    assert.throws(() => new AbstractMessage(), /AbstractMessage.*wireFields/);
});

test("Validate accepts by default", () => {
    assert.strictEqual(new ValidMessage().validate(null, null), true);
});

test("SetViewportMessage.validate accepts a chunk list within the limit", () => {
    const chunks = Array.from({length: 256}, (_, i) => `${i}_0`);
    assert.strictEqual(new SetViewportMessage(chunks).validate(null, null), true);
});

test("SetViewportMessage.validate rejects a chunk list over the limit", () => {
    const chunks = Array.from({length: 257}, (_, i) => `${i}_0`);
    assert.strictEqual(new SetViewportMessage(chunks).validate(null, null), false);
});
