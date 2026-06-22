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

test("a subclass that declares wireFields constructs", () => {
    assert.doesNotThrow(() => new ValidMessage());
});

test("a subclass without wireFields throws on construction", () => {
    assert.throws(() => new MissingFieldsMessage(), /MissingFieldsMessage.*wireFields/);
});

test("instantiating the base Message directly throws", () => {
    assert.throws(() => new Message(), /Message.*wireFields/);
});

test("validate accepts by default", () => {
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
