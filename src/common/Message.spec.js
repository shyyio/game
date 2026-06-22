import {test} from "node:test";
import assert from "node:assert";

import {Message} from "@/common/Message.js";
import {SetViewportMessage} from "@/common/CoreMessages.js";

class ValidMessage extends Message {

    static wireFields = {
        type: "int32",
    };
}

class MissingFieldsMessage extends Message {

}

test("A subclass that declares wireFields constructs", () => {
    assert.doesNotThrow(() => new ValidMessage(1));
});

test("A subclass without wireFields throws on construction", () => {
    assert.throws(() => new MissingFieldsMessage(1), /MissingFieldsMessage.*wireFields/);
});

test("Instantiating the base Message directly throws", () => {
    assert.throws(() => new Message(1), /Message.*wireFields/);
});

test("Validate accepts by default", () => {
    assert.strictEqual(new ValidMessage(1).validate(null, null), true);
});

test("SetViewportMessage.validate accepts a chunk list within the limit", () => {
    const chunks = Array.from({length: 256}, (_, i) => `${i}_0`);
    assert.strictEqual(new SetViewportMessage(chunks).validate(null, null), true);
});

test("SetViewportMessage.validate rejects a chunk list over the limit", () => {
    const chunks = Array.from({length: 257}, (_, i) => `${i}_0`);
    assert.strictEqual(new SetViewportMessage(chunks).validate(null, null), false);
});
