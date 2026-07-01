import {test} from "node:test";
import assert from "node:assert";

import {AbstractTilePositionedEvent} from "@/common/AbstractTilePositionedEvent.js";
import {AbstractEvent} from "@/common/AbstractEvent.js";
import {chunkId} from "@/common/util.js";

test("AbstractTilePositionedEvent derives its chunk from its tile position", () => {
    class WithFields extends AbstractTilePositionedEvent {
        static wireFields = {x: "int32", y: "int32"};
    }
    const event = new WithFields(70, 5);
    assert.ok(event instanceof AbstractEvent);
    assert.strictEqual(event.x, 70);
    assert.strictEqual(event.y, 5);
    assert.strictEqual(event.chunk, chunkId(70, 5));
});

test("a AbstractTilePositionedEvent subclass without wireFields throws", () => {
    class MissingFields extends AbstractTilePositionedEvent {}
    assert.throws(
        () => new MissingFields(0, 0),
        /MissingFields extends AbstractMessage but has no static wireFields/,
    );
});
