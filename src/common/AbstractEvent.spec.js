import {test} from "node:test";
import assert from "node:assert";

import {AbstractEvent} from "@/common/AbstractEvent.js";

test("a AbstractEvent subclass with wireFields constructs and carries no position", () => {
    class WithFields extends AbstractEvent {
        static wireFields = {value: "int32"};
    }
    const event = new WithFields();
    assert.ok(event instanceof AbstractEvent);
    assert.strictEqual(event.x, undefined);
    assert.strictEqual(event.chunk, undefined);
});

test("constructing an AbstractEvent subclass without wireFields throws", () => {
    class MissingFields extends AbstractEvent {}
    assert.throws(
        () => new MissingFields(),
        /MissingFields extends AbstractMessage but has no static wireFields/,
    );
});
