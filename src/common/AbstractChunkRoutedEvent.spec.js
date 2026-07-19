import {test} from "node:test";
import assert from "node:assert";

import {AbstractChunkRoutedEvent} from "@/common/AbstractChunkRoutedEvent.js";
import {AbstractEvent} from "@/common/AbstractEvent.js";
import {chunkId} from "@/common/util.js";

test("AbstractChunkRoutedEvent derives its chunk from its tile position", () => {
    class WithFields extends AbstractChunkRoutedEvent {
        static wireFields = {x: "int32", y: "int32"};
    }
    const event = new WithFields(70, 5);
    assert.ok(event instanceof AbstractEvent);
    assert.strictEqual(event.x, 70);
    assert.strictEqual(event.y, 5);
    assert.strictEqual(event.chunk, chunkId(70, 5));
});

test("a AbstractChunkRoutedEvent subclass without wireFields throws", () => {
    class MissingFields extends AbstractChunkRoutedEvent {}
    assert.throws(
        () => new MissingFields(0, 0),
        /MissingFields extends AbstractWireObject but has no static wireFields/,
    );
});
